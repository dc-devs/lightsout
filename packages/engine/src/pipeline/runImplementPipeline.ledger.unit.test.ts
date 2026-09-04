import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { Driver } from '#src/drivers/index.ts';
import { ledgerCopyPath } from '#src/pipeline/common/utils/ledgerCopyPath.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { reachabilityRulesOff, setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

const ledgerFile = 'src/widget.unit.test.js';
const ledgerTestName = 'widget: doubles its input';
const gadgetFile = 'src/gadget.unit.test.js';
const gadgetTestName = 'gadget: renders its label';

/** A test file stating exactly the named cases — what a ledger writer leaves on disk. */
const bodyOf = ({ names }: { names: string[] }) => `${names.map((name) => `test('${name}', () => {});`).join('\n')}\n`;

const ledgerBody = bodyOf({ names: [ledgerTestName] });
const gadgetBody = bodyOf({ names: [gadgetTestName] });
const goodRow = `| a widget doubles its input | \`${ledgerFile}\` | ${ledgerTestName} | test |`;
const gadgetRow = `| a gadget renders its label | \`${gadgetFile}\` | ${gadgetTestName} | test |`;
// the test-file cell carries no backticked span, so the parser can read no path out of it
const unreadableRow = `| a widget doubles its input | ${ledgerFile} | ${ledgerTestName} | test |`;

/** The one source module the executor lands when a test names no other. */
const widgetModule = { 'src/widget.js': 'export const widget = (n) => n * 2;\n' };

/**
 * The two rules asking where a test file sits are off because these fixtures'
 * ledger test files are planted by an agent mid-run — a run stopped on the
 * fixture's shape never reaches the question this suite asks.
 */
const ledgerRepoConfig = {
	'standards-checks': { ...reachabilityRulesOff['standards-checks'], 'test-in-tests-folder': 'off', 'test-not-beside-subject': 'off' },
};

/** The file one ledger-writer brief names, and every test name it lists. */
const assignmentOf = ({ prompt }: { prompt: string }) => ({
	path: /Write these tests, and only these, in `([^`]+)`/.exec(prompt)?.[1] ?? '',
	names: [...prompt.matchAll(/test name: `([^`]+)`/g)].map(([, name]) => name),
});

/**
 * A plan whose `## Acceptance Tests` table holds the given rows, after the
 * template's header row and its rule. The rows land on file line 7 onward,
 * which is the number the engine reports an unreadable one by.
 */
const planWith = ({ rows }: { rows: string[] }) =>
	['# Plan: add the widget', '', '## Acceptance Tests', '', '| Criterion | Test file | Test name | Gate |', '| --- | --- | --- | --- |', ...rows, ''].join(
		'\n',
	);

interface SetupParams {
	plan: string;
	/** Source modules the executor lands, by repo-relative path. */
	implemented?: Record<string, string>;
	/** What the executor writes over the locked ledger test file; omitted, it leaves the file alone. */
	executorEdit?: string;
}

/**
 * A consumer repo driven by a stub that answers every role of a full run: the
 * ledger writer plants exactly the tests its brief names, the executor
 * implements the modules the ledger is about, and both hand back what they
 * touched.
 */
const setupLedgerRun = async ({ plan, implemented = widgetModule, executorEdit }: SetupParams) => {
	const dir = setupConsumerRepo({ plan, config: ledgerRepoConfig });
	const prompts: { role: string; prompt: string }[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			// the ledger writer is the unit-test-writer role with a different
			// assignment, so its own assignment heading is what names it
			const role = prompt.includes('# Ledger tests to write') ? 'write-ledger-tests' : roleOf(prompt);

			prompts.push({ role, prompt });

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-ledger-tests') {
				const { path, names } = assignmentOf({ prompt });

				writeFileSync(join(dir, path), bodyOf({ names }));

				return { text: report({ changedFiles: [{ path, summary: 'ledger tests' }] }), exitCode: 0 };
			}

			if (role === 'implement') {
				for (const [path, source] of Object.entries(implemented)) {
					writeSource({ dir, path, source });
				}

				if (executorEdit !== undefined) {
					writeFileSync(join(dir, ledgerFile), executorEdit);
				}

				return { text: report({ changedFiles: Object.keys(implemented).map((path) => ({ path, summary: 'module' })) }), exitCode: 0 };
			}

			return { text: report(), exitCode: 0 };
		},
	};

	return { dir, driver, prompts, config: await readConfig({ cwd: dir }) };
};

/** The same repo, driven by a harness that hands the ledger writer a rate limit instead of a report. */
const setupParkedLedgerRun = async () => {
	const dir = setupConsumerRepo({ plan: planWith({ rows: [goodRow] }), config: ledgerRepoConfig });
	const prompts: { role: string; prompt: string }[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const isLedgerWriter = prompt.includes('# Ledger tests to write');

			prompts.push({ role: isLedgerWriter ? 'write-ledger-tests' : roleOf(prompt), prompt });

			return isLedgerWriter ? { text: '', exitCode: 1, rateLimited: true } : { text: report(), exitCode: 0 };
		},
	};

	return { dir, driver, prompts, config: await readConfig({ cwd: dir }) };
};

describe('runImplementPipeline', () => {
	test("write-ledger-tests: the ledger's tests are written and locked before the executor is briefed with them", async () => {
		const { dir, driver, prompts, config } = await setupLedgerRun({ plan: planWith({ rows: [goodRow] }) });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		const implementPrompt = prompts.find((entry) => entry.role === 'implement')?.prompt ?? '';

		expect(result.ok).toBe(true);
		// the tests that define done are written first — before the party they judge
		// has been asked for anything
		expect(prompts[0]?.role).toBe('write-ledger-tests');
		expect(prompts[0]?.prompt.includes(`Write these tests, and only these, in \`${ledgerFile}\``)).toBeTruthy();
		// the lock the manifest carries is the hash of the bytes the writer left
		expect(result.manifest.ledgerTests).toStrictEqual([{ path: ledgerFile, testNames: [ledgerTestName], sha256: sha256({ content: ledgerBody }) }]);
		// and the run holds its own copy, which is what a later verify restores from
		expect(readFileSync(ledgerCopyPath({ cwd: dir, runId: result.manifest.runId, path: ledgerFile }), 'utf8')).toBe(ledgerBody);
		// the executor is handed the locked path, so it fixes source rather than the test
		expect(implementPrompt.includes(`# Ledger tests (read-only)\n\n- ${ledgerFile}`)).toBeTruthy();
	});

	test('write-ledger-tests: every test file the ledger names gets its own writer, and each is locked separately', async () => {
		const { dir, driver, prompts, config } = await setupLedgerRun({
			plan: planWith({ rows: [goodRow, gadgetRow] }),
			implemented: { ...widgetModule, 'src/gadget.js': "export const gadget = () => 'label';\n" },
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		const implementPrompt = prompts.find((entry) => entry.role === 'implement')?.prompt ?? '';

		expect(result.ok).toBe(true);
		// one writer per file, every one of them ahead of the executor
		expect(prompts.filter((entry) => entry.role === 'write-ledger-tests').length).toBe(2);
		expect(result.manifest.ledgerTests).toStrictEqual([
			{ path: ledgerFile, testNames: [ledgerTestName], sha256: sha256({ content: ledgerBody }) },
			{ path: gadgetFile, testNames: [gadgetTestName], sha256: sha256({ content: gadgetBody }) },
		]);
		// each file has its own copy to restore from, kept under its own repo-relative path
		expect(readFileSync(ledgerCopyPath({ cwd: dir, runId: result.manifest.runId, path: gadgetFile }), 'utf8')).toBe(gadgetBody);
		// and the executor is barred from both, in the ledger's own order
		expect(implementPrompt.includes(`# Ledger tests (read-only)\n\n- ${ledgerFile}\n- ${gadgetFile}`)).toBeTruthy();
	});

	test('write-ledger-tests: a rate-limited ledger writer parks the run with nothing locked', async () => {
		const { dir, driver, prompts, config } = await setupParkedLedgerRun();

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		expect(result.ok).toBe(false);
		expect(result.manifest.status).toBe('paused-rate-limit');
		// a half-written ledger locks nothing, so the resumed run writes it from the top
		expect(result.manifest.ledgerTests).toStrictEqual([]);
		// and no executor was paid for against tests that do not exist yet
		expect(prompts.every((entry) => entry.role !== 'implement')).toBeTruthy();
	});

	test('verify: an executor edit to a locked ledger test is reverted before the gates run', async () => {
		const { dir, driver, config } = await setupLedgerRun({
			plan: planWith({ rows: [goodRow] }),
			executorEdit: `test('${ledgerTestName}', () => { /* gutted */ });\n`,
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		// the party being verified never edits the verifier: the gates ran against
		// the file the ledger writer produced, and the edit bought the executor
		// nothing at all
		expect(result.ok).toBe(true);
		expect(readFileSync(join(dir, ledgerFile), 'utf8')).toBe(ledgerBody);
		expect(result.manifest.ledgerTests[0]?.sha256).toBe(sha256({ content: ledgerBody }));
	});

	test('write-tests: the locked ledger test file is named read-only to the coverage writers too', async () => {
		const { dir, driver, prompts, config } = await setupLedgerRun({ plan: planWith({ rows: [goodRow] }) });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		const writerPrompts = prompts.filter((entry) => entry.role === 'write-tests').map((entry) => entry.prompt);

		expect(result.ok).toBe(true);
		// a coverage writer that added a case to a locked file would have it
		// reverted, so every one of them is told where such a case goes instead
		expect(writerPrompts.length > 0).toBeTruthy();
		expect(writerPrompts.every((prompt) => prompt.includes(`# Ledger tests (read-only)\n\n- ${ledgerFile}`))).toBeTruthy();
	});

	test('write-ledger-tests: a plan carrying no ledger records why it was skipped and locks nothing', async () => {
		const { dir, driver, prompts, config } = await setupLedgerRun({ plan: '# Plan: add the widget\n' });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		const skipped = result.manifest.steps.find((record) => record.id === 'write-ledger-tests');

		expect(result.ok).toBe(true);
		// the manifest explains the whole run, including the part that did not happen
		expect(skipped?.report).toEqual(expect.objectContaining({ skipped: 'the plan carries no acceptance-test ledger' }));
		expect(result.manifest.ledgerTests).toStrictEqual([]);
		// no lock means no read-only section for any role — the header is omitted,
		// never emitted empty
		expect(prompts.every((entry) => !entry.prompt.includes('# Ledger tests (read-only)'))).toBeTruthy();
	});

	test('check-ledger: a ledger row the engine cannot read stops the run before any agent is paid for', async () => {
		const { dir, driver, prompts, config } = await setupLedgerRun({ plan: planWith({ rows: [unreadableRow] }) });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		expect(result.ok).toBe(false);
		// the same verdict the plan-time lint gives, located by the line a human
		// can jump to
		expect(result.error ?? '').toContain('at line(s) 7');
		// it is the first step of the declared sequence, ahead of clean-slate, so
		// nothing runs against a plan that cannot be implemented
		expect(result.manifest.stepOrder?.[0]).toBe('check-ledger');
		expect(prompts).toStrictEqual([]);
	});
});
