import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { runImplementPipeline } from '#src/pipeline/runImplementPipeline.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { verdict } from '#tests/helpers/verdict.ts';

/** A plan whose whole work is one rename, declared the way a rename-only plan declares it. */
const planContent = ['# Plan: rename feature to widget', '', '## Renames', '', '- `feature` → `widget`', ''].join('\n');

/**
 * The committed repo: a module the rename moves, and a module that calls it
 * with a literal. `setupConsumerRepo` plants a consumer beside each —
 * `src/useFeature.js` and `src/useCount.js` — and the first of those is edited
 * in place by the rename, since the rename is case-sensitive and leaves its
 * `useFeature` name alone.
 */
const committedSources = {
	'src/feature.js': 'export const feature = (n) => n + 1;\n',
	'src/count.js': "import { feature } from './feature.js';\n\nexport const count = () => feature(1);\n",
};

/** The marker the verify-tests gate prints when it goes red, so the repair it hands out can be recognised. */
const buildRedMarker = 'BUILD-RED';

/** The cheap gates at the first two checkpoints, and the `build` gate added at verify-tests alone. */
const verifyTestsOnlyBuild = {
	'clean-slate': ['check', 'test'],
	'verify-implement': ['check', 'test'],
	'verify-tests': ['check', 'test', 'build'],
};

/**
 * The declared rename applied by hand, as the implement agent applies it: the
 * module moved to its renamed path, and every reference renamed. `literal` is
 * what `count` passes — anything but 1 is a change no rename explains.
 */
const applyTheRename = ({ dir, literal }: { dir: string; literal: number }) => {
	rmSync(join(dir, 'src/feature.js'), { force: true });
	writeFileSync(join(dir, 'src/widget.js'), 'export const widget = (n) => n + 1;\n');
	writeFileSync(join(dir, 'src/useFeature.js'), "import { widget } from './widget.js';\n\nconsole.log(widget);\n");
	writeFileSync(join(dir, 'src/count.js'), `import { widget } from './widget.js';\n\nexport const count = () => widget(${literal});\n`);
};

const renamedFiles = [
	{ path: 'src/widget.js', summary: 'moved from src/feature.js' },
	{ path: 'src/useFeature.js', summary: 'renamed the import' },
	{ path: 'src/count.js', summary: 'renamed the call' },
];

/**
 * Which role a stub invocation is answering. The test-change reviewer is named
 * by its bundle heading and the ledger writer by its assignment heading — both
 * would otherwise fall through `roleOf` to another role.
 */
const roleFor = ({ prompt }: { prompt: string }) => {
	if (prompt.includes('# Changed test-side files')) {
		return 'test-review';
	}

	if (prompt.includes('# Ledger tests to write')) {
		return 'write-ledger-tests';
	}

	return roleOf(prompt);
};

interface SetupParams {
	/** What the implement agent's first turn leaves `count` passing; the fix turn always restores 1. */
	implementLiteral?: number;
	/** Give verify-tests alone a gate that stays red until a fix turn has run. */
	redVerifyTestsGate?: boolean;
}

/**
 * A consumer repo carrying a rename-only plan, driven by a stub that answers
 * every role. The implement agent and its fix turn apply the rename; every
 * other role answers with an empty report, and nothing answers a test-change
 * review honestly — a review reaching this stub fails the run on the contract.
 *
 * The red verify-tests gate is a `build` command reading a flag file outside the
 * repo, which only the fix turn writes. Outside the repo, because the flag is
 * not a rename, and a rename-only run refuses any file the rename does not
 * explain. The two earlier checkpoints are held to the cheap gates so the flag
 * is asked for at verify-tests alone.
 */
const setupRenameRun = async ({ implementLiteral = 1, redVerifyTestsGate = false }: SetupParams = {}) => {
	const flagPath = join(mkdtempSync(join(tmpdir(), 'lightsout-rename-flag-')), 'fixed');
	const dir = setupConsumerRepo({
		plan: planContent,
		sources: committedSources,
		...(redVerifyTestsGate
			? {
					scripts: { build: `test -f ${flagPath} || (echo ${buildRedMarker} >&2; exit 1)` },
					config: { 'gate-overrides': verifyTestsOnlyBuild },
				}
			: {}),
	});
	const invocations: { role: string; prompt: string; systemPrompt?: string }[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, systemPrompt }) => {
			const role = roleFor({ prompt });

			invocations.push({ role, prompt, systemPrompt });

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'supervisor') {
				return { text: verdict(), exitCode: 0 };
			}

			if (role === 'implement') {
				applyTheRename({ dir, literal: implementLiteral });

				return { text: report({ changedFiles: renamedFiles }), exitCode: 0 };
			}

			if (role === 'fix') {
				applyTheRename({ dir, literal: 1 });
				writeFileSync(flagPath, 'fixed\n');

				return { text: report({ changedFiles: renamedFiles }), exitCode: 0 };
			}

			return { text: report(), exitCode: 0 };
		},
	};

	return { dir, driver, invocations, config: await readConfig({ cwd: dir }) };
};

describe('runImplementPipeline', () => {
	test('a rename-only plan skips both test writers and the refactor steps, runs no test-change review, and passes', async () => {
		const { dir, driver, invocations, config } = await setupRenameRun();

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

		const ledgerWriter = result.manifest.steps.find((step) => step.id === 'write-ledger-tests');
		const testWriter = result.manifest.steps.find((step) => step.id === 'write-tests');

		expect(result.ok).toBe(true);
		// no refactor pair, though the run was not asked to skip it: a refactor's
		// edits are not renames, so the rename check would refuse them
		expect(result.manifest.stepOrder).toStrictEqual([
			'clean-slate',
			'write-ledger-tests',
			'implement',
			'format-implement',
			'verify-implement',
			'write-tests',
			'format-tests',
			'verify-tests',
		]);
		// both writers say why they wrote nothing, and the reason is the rename
		// rather than the absent ledger or an absence of source
		expect(ledgerWriter?.report).toEqual(expect.objectContaining({ skipped: expect.stringMatching(/rename/i) }));
		expect(testWriter?.report).toEqual(expect.objectContaining({ skipped: expect.stringMatching(/rename/i) }));
		expect(invocations.map((entry) => entry.role).filter((role) => ['test-review', 'write-ledger-tests', 'write-tests'].includes(role))).toStrictEqual([]);
	});

	test("a rename-only plan refused by the rename check is repaired by the implement agent's fix turn", async () => {
		const { dir, driver, invocations, config } = await setupRenameRun({ implementLiteral: 2 });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

		const checkpoint = result.manifest.steps.find((step) => step.id === 'verify-implement');
		const fixPrompts = invocations.filter((entry) => entry.role === 'fix').map((entry) => entry.prompt);

		expect(result.ok).toBe(true);
		// the one repair the checkpoint spent was on the rename check's refusal
		expect(checkpoint?.verification?.repairAttempts).toStrictEqual({ 'rename-check': 1 });
		// and the implement agent was told which file carried the change no rename explains
		expect(fixPrompts).toHaveLength(1);
		expect(fixPrompts[0]).toContain('src/count.js');
	});

	test("a rename-only plan's verify-tests repair goes to the implement agent, never the unit-test writer", async () => {
		const { dir, driver, invocations, config } = await setupRenameRun({ redVerifyTestsGate: true });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

		const repairs = invocations
			.filter((entry) => entry.role === 'fix')
			.map((entry) => ({
				repairsTheGate: entry.prompt.includes(buildRedMarker),
				briefedRenameOnly: entry.systemPrompt?.includes('# Rename-only phase') === true,
			}));

		expect(result.ok).toBe(true);
		// one feature-executor fix, handed the verify-tests gate's red, briefed as a rename-only phase
		expect(repairs).toStrictEqual([{ repairsTheGate: true, briefedRenameOnly: true }]);
		// a unit-test writer would be sent to repair a phase that must write no tests
		expect(invocations.map((entry) => entry.role)).not.toContain('write-tests');
	});
});
