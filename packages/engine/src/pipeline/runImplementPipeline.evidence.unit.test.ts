import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { gateResultsCommand } from '#tests/helpers/gateResultsCommand.ts';
import { readCommandLog } from '#tests/helpers/readCommandLog.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { reachabilityRulesOff, setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { verdict } from '#tests/helpers/verdict.ts';
import { withTestChangeReview } from '#tests/helpers/withTestChangeReview.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

const ledgerFile = 'src/widget.unit.test.js';
const ledgerTestName = 'widget: doubles its input';
const ledgerRow = `| a widget doubles its input | \`${ledgerFile}\` | ${ledgerTestName} | test |`;

/**
 * The two rules asking where a test file sits are off because this fixture's
 * ledger test file is planted by an agent mid-run — a run stopped on the
 * fixture's shape never reaches the question this suite asks.
 */
const ledgerRepoConfig = {
	'standards-checks': { ...reachabilityRulesOff['standards-checks'], 'test-in-tests-folder': 'off', 'test-not-beside-subject': 'off' },
};

/** A plan whose `## Acceptance Tests` table holds the given rows, after the template's header row and its rule. */
const planWith = ({ rows }: { rows: string[] }) =>
	['# Plan: add the widget', '', '## Acceptance Tests', '', '| Criterion | Test file | Test name | Gate |', '| --- | --- | --- | --- |', ...rows, ''].join(
		'\n',
	);

/** The file one ledger-writer brief names, and every test name it lists. */
const assignmentOf = ({ prompt }: { prompt: string }) => ({
	path: /Write these tests, and only these, in `([^`]+)`/.exec(prompt)?.[1] ?? '',
	names: [...prompt.matchAll(/test name: `([^`]+)`/g)].map(([, name]) => name),
});

/** A test file stating exactly the named cases — what a ledger writer leaves on disk. */
const bodyOf = ({ names }: { names: string[] }) => `${names.map((name) => `test('${name}', () => {});`).join('\n')}\n`;

interface SetupParams {
	/** The repo's `test` gate command — what per-test evidence this run's suite leaves behind. */
	testGate: string;
	/** The repo's `gate-overrides` block; omitted, every checkpoint keeps the engine's default schedule. */
	overrides?: Record<string, 'off' | string[]>;
}

/**
 * A consumer repo carrying a one-row acceptance ledger, whose unit suite is a
 * fake command that writes exactly the per-test evidence the case is about.
 *
 * The stub driver answers every role of a full run: the ledger writer plants
 * the tests its brief names, the executor implements the module the ledger is
 * about, and the supervisor escalates rather than sending the run round again.
 */
const setupEvidenceRun = async ({ testGate, overrides }: SetupParams) => {
	const dir = setupConsumerRepo({
		plan: planWith({ rows: [ledgerRow] }),
		scripts: { test: testGate },
		config: { ...ledgerRepoConfig, 'gate-overrides': overrides ?? {} },
	});
	const prompts: { role: string; prompt: string }[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt }) => {
				// the ledger writer is the unit-test-writer role with a different
				// assignment, so its own assignment heading is what names it
				const role = prompt.includes('# Ledger tests to write') ? 'write-ledger-tests' : roleOf(prompt);

				prompts.push({ role, prompt });

				if (role === 'standards-review') {
					return { text: reviewReport(), exitCode: 0 };
				}

				if (role === 'supervisor') {
					return { text: verdict(), exitCode: 0 };
				}

				if (role === 'write-ledger-tests') {
					const { path, names } = assignmentOf({ prompt });

					writeFileSync(join(dir, path), bodyOf({ names }));

					return { text: report({ changedFiles: [{ path, summary: 'ledger tests' }] }), exitCode: 0 };
				}

				if (role === 'implement') {
					writeSource({ dir, path: 'src/widget.js', source: 'export const widget = (n) => n * 2;\n' });

					return { text: report({ changedFiles: [{ path: 'src/widget.js', summary: 'module' }] }), exitCode: 0 };
				}

				return { text: report(), exitCode: 0 };
			},
		}),
	};

	return { dir, driver, prompts, config: await readConfig({ cwd: dir }) };
};

describe('runImplementPipeline', () => {
	test('implement: stops at clean-slate when a ledger gate produced no per-test results', async () => {
		// the suite is green and silent: it exits 0 and leaves no per-test
		// evidence at all, which is what a jest config that never loads the
		// reporter looks like from outside
		const { dir, driver, prompts, config } = await setupEvidenceRun({ testGate: 'true' });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		expect(result.ok).toBe(false);
		expect(result.manifest.status).toBe('failed');
		expect(result.manifest.steps.find((step) => step.id === 'clean-slate')?.status).toBe('failed');
		// the message has to be enough to fix the setup on its own, so it names
		// both variables the engine sets on every gate command
		expect(result.error ?? '').toContain('LIGHTSOUT_JEST_REPORTER');
		expect(result.error ?? '').toContain('LIGHTSOUT_TEST_RESULTS_DIR');
		// clean-slate is the last free moment — a repository that cannot prove a
		// row buys no agent turn to learn it
		expect(prompts).toStrictEqual([]);
		expect(result.manifest.steps.find((step) => step.id === 'write-ledger-tests')).toBe(undefined);
	});

	test('implement: fails the final verification when an acceptance test never executed', async () => {
		const { dir, driver, config } = await setupEvidenceRun({
			// the suite reports one unrelated case, so the reporter is plainly
			// working and the only thing missing is the test the ledger names
			testGate: gateResultsCommand({ tests: [{ file: 'src/other.unit.test.js', name: 'other: is unrelated' }] }),
			// verify-implement never runs the row's gate, so that checkpoint cannot
			// judge the row and the run's last verification is the one that must
			overrides: { 'verify-implement': ['check'] },
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		const finalStep = result.manifest.steps.find((step) => step.id === 'verify-tests');

		expect(result.ok).toBe(false);
		expect(finalStep?.status).toBe('escalated');
		expect(finalStep?.verification).toEqual(expect.objectContaining({ failedFamilies: ['acceptance-tests'] }));
		// the fix role has to find the test without opening the run folder
		expect(result.error ?? '').toContain(ledgerTestName);
		expect(result.error ?? '').toContain(ledgerFile);
		// a checkpoint that never ran the row's gate skips the row rather than
		// failing it — an earlier red there would be the wrong verdict
		expect(result.manifest.steps.find((step) => step.id === 'verify-implement')?.status).toBe('passed');
	});

	test('implement: passes when every acceptance test executed and passed at the checkpoints that ran its gate', async () => {
		const { dir, driver, config } = await setupEvidenceRun({
			testGate: gateResultsCommand({ tests: [{ file: ledgerFile, name: ledgerTestName, status: 'passed' }] }),
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		const testGates = readCommandLog(dir, result.manifest.runId).filter((entry) => entry.kind === 'test');

		expect(result.ok).toBe(true);
		expect(result.manifest.steps.find((step) => step.id === 'verify-implement')?.status).toBe('passed');
		expect(result.manifest.steps.find((step) => step.id === 'verify-tests')?.status).toBe('passed');
		// and every execution of the suite is on the durable record with the
		// directory its evidence went to
		expect(testGates.length > 0).toBeTruthy();
		expect(testGates.every((entry) => typeof entry.testResultsDir === 'string')).toBeTruthy();
	});
});
