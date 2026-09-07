import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { writeSource } from '#tests/helpers/writeSource.ts';

const criterion = 'a widget doubles its input';
const ledgerFile = 'src/widget.unit.test.js';
const movedFile = 'src/doubler.unit.test.js';
const ledgerTestName = 'widget: doubles its input';
const ledgerRow = `| ${criterion} | \`${ledgerFile}\` | ${ledgerTestName} | test |`;

/** A test file stating exactly the named cases — what a ledger writer leaves on disk. */
const bodyOf = ({ names }: { names: string[] }) => `${names.map((name) => `test('${name}', () => {});`).join('\n')}\n`;

/**
 * The correction an executor makes to a ledger test file: the module the plan
 * landed is now imported and asserted on. The ledger's own name still heads the
 * case, so the correction is the legitimate kind — stale wiring caught up to the
 * plan's own work — rather than a weakening.
 */
const correctedBody = [
	"import { widget } from './widget.js';",
	'',
	`test('${ledgerTestName}', () => { if (widget(2) !== 4) { throw new Error('widget did not double'); } });`,
	'',
].join('\n');

/** The refusal the reviewer states, and the sentence the checkpoint has to carry to whoever repairs it. */
const refusalReason = 'the assertion was replaced with a bare call, so the case can no longer fail';

/**
 * The two rules asking where a test file sits are off because this fixture's
 * ledger test file is planted by an agent mid-run — a run stopped on the
 * fixture's shape never reaches the question this suite asks.
 */
const reviewRepoConfig = {
	'standards-checks': { ...reachabilityRulesOff['standards-checks'], 'test-in-tests-folder': 'off', 'test-not-beside-subject': 'off' },
};

/** A plan whose `## Acceptance Tests` table holds the one row this suite is about. */
const planContent = [
	'# Plan: add the widget',
	'',
	'## Acceptance Tests',
	'',
	'| Criterion | Test file | Test name | Gate |',
	'| --- | --- | --- | --- |',
	ledgerRow,
	'',
].join('\n');

/** The file one ledger-writer brief names, and every test name it lists. */
const assignmentOf = ({ prompt }: { prompt: string }) => ({
	path: /Write these tests, and only these, in `([^`]+)`/.exec(prompt)?.[1] ?? '',
	names: [...prompt.matchAll(/test name: `([^`]+)`/g)].map(([, name]) => name),
});

/** The run's approved-copy root, spelled out rather than imported, so the test states the path the run promises. */
const approvedDir = ({ dir, runId }: { dir: string; runId: string }) => join(dir, '.lightsout', 'runs', runId, 'approved');

const hashOf = ({ content }: { content: string }) => createHash('sha256').update(content).digest('hex');

/**
 * Which role a stub invocation is answering.
 *
 * The test-change reviewer is a read-only judge with no heading `roleOf` knows,
 * so it would fall through to the executor. The other two read-only judges are
 * named by their own task headings first, which leaves read-only permissions as
 * an unambiguous name for the reviewer.
 */
const roleFor = ({ prompt, permissions }: { prompt: string; permissions?: string }) => {
	// the ledger writer is the unit-test-writer role with a different
	// assignment, so its own assignment heading is what names it
	if (prompt.includes('# Ledger tests to write')) {
		return 'write-ledger-tests';
	}

	if (prompt.includes('# Files in scope for the standards review')) {
		return 'standards-review';
	}

	if (prompt.includes('# Failing step')) {
		return 'supervisor';
	}

	return permissions === 'read-only' ? 'test-review' : roleOf(prompt);
};

interface Verdict {
	path: string;
	decision: string;
	reason: string;
	acceptanceTests?: { testName: string; disposition: string; newTestName?: string; testFile?: string }[];
}

interface SetupParams {
	/** What the executor writes over the ledger test file; omitted, it leaves the file alone. */
	executorEdit?: string;
	/** Where the executor moves the ledger test file, carrying every case it held. */
	movedTo?: string;
	/** What the reviewer answers with, one verdict per file. A verdict for a path outside the bundle is the engine's to ignore. */
	verdicts?: Verdict[];
	/** The per-test evidence the unit suite leaves behind, by repo-relative test file and test name. */
	evidence?: { file: string; name: string }[];
}

/**
 * A consumer repo carrying a one-row acceptance ledger, driven by a stub that
 * answers every role of a full run: the ledger writer plants the test its brief
 * names, the executor implements the module the ledger is about and edits or
 * moves the test file, the reviewer rules on what the executor did to it, and
 * the supervisor escalates rather than sending the run round again.
 */
const setupReviewRun = async ({ executorEdit, movedTo, verdicts = [], evidence }: SetupParams = {}) => {
	const dir = setupConsumerRepo({
		plan: planContent,
		scripts: { test: gateResultsCommand({ tests: evidence ?? [{ file: ledgerFile, name: ledgerTestName }] }) },
		config: reviewRepoConfig,
	});
	const prompts: { role: string; prompt: string }[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, permissions }) => {
			const role = roleFor({ prompt, permissions });

			prompts.push({ role, prompt });

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'supervisor') {
				return { text: verdict(), exitCode: 0 };
			}

			if (role === 'test-review') {
				return { text: JSON.stringify({ verdicts }), exitCode: 0 };
			}

			if (role === 'write-ledger-tests') {
				const { path, names } = assignmentOf({ prompt });

				writeFileSync(join(dir, path), bodyOf({ names }));

				return { text: report({ changedFiles: [{ path, summary: 'ledger tests' }] }), exitCode: 0 };
			}

			if (role === 'implement') {
				writeSource({ dir, path: 'src/widget.js', source: 'export const widget = (n) => n * 2;\n' });

				if (executorEdit !== undefined) {
					writeFileSync(join(dir, ledgerFile), executorEdit);
				}

				if (movedTo !== undefined) {
					const carried = readFileSync(join(dir, ledgerFile), 'utf8');

					rmSync(join(dir, ledgerFile));
					writeFileSync(join(dir, movedTo), carried);
				}

				return { text: report({ changedFiles: [{ path: 'src/widget.js', summary: 'module' }] }), exitCode: 0 };
			}

			return { text: report(), exitCode: 0 };
		},
	};

	return { dir, driver, prompts, config: await readConfig({ cwd: dir }) };
};

/** The reviewer approving the executor's correction and saying the named test is still where it was. */
const keptVerdict: Verdict[] = [
	{
		path: ledgerFile,
		decision: 'approve',
		reason: "the import caught up to the module the plan landed, and the case still asserts the widget's output",
		acceptanceTests: [{ testName: ledgerTestName, disposition: 'kept' }],
	},
];

/** The reviewer refusing the same edit. */
const refusedVerdict: Verdict[] = [{ path: ledgerFile, decision: 'reject', reason: refusalReason, acceptanceTests: [] }];

/** The reviewer approving a move: the source is gone, the destination carries the case, and the mapping follows it. */
const movedVerdict: Verdict[] = [
	{
		path: ledgerFile,
		decision: 'approve',
		reason: 'the file moved with the module it tests and left nothing behind',
		acceptanceTests: [{ testName: ledgerTestName, disposition: 'moved', testFile: movedFile }],
	},
	{ path: movedFile, decision: 'approve', reason: 'the destination carries every case the source held', acceptanceTests: [] },
];

describe('runImplementPipeline', () => {
	test('verify: an approved correction to a ledger test file reaches the gates as written', async () => {
		const { dir, driver, prompts, config } = await setupReviewRun({ executorEdit: correctedBody, verdicts: keptVerdict });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		const approvedRecord = result.manifest.approvedTests.find((record) => record.path === ledgerFile);

		expect(result.ok).toBe(true);
		// the engine never writes to the working tree: the bytes the executor left
		// are the bytes the gates ran against, where the old whole-file lock would
		// have put its copy back over them
		expect(readFileSync(join(dir, ledgerFile), 'utf8')).toBe(correctedBody);
		// one reviewer invocation judged the change, and it judged it before the
		// checkpoint's gates were spent
		expect(prompts.filter((entry) => entry.role === 'test-review').length).toBe(1);
		// and the approval moved the baseline forward, so the corrected file is
		// what the next checkpoint diffs against rather than a stale copy
		expect(approvedRecord).toEqual(expect.objectContaining({ sha256: hashOf({ content: correctedBody }), removed: false }));
		// the row is still proven, under the file and name it still carries
		expect(result.manifest.acceptanceTests).toStrictEqual([{ criterion, testFile: ledgerFile, testName: ledgerTestName, gate: 'test' }]);
	});

	test('verify: a refused edit to a ledger test file goes red under test-review with no gate run', async () => {
		const { dir, driver, config } = await setupReviewRun({ executorEdit: correctedBody, verdicts: refusedVerdict });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		const checkpoint = result.manifest.steps.find((step) => step.id === 'verify-implement');
		const checkpointGates = readCommandLog(dir, result.manifest.runId).filter((entry) => entry.step === 'verify-implement' && entry.kind !== 'format');

		expect(result.ok).toBe(false);
		expect(checkpoint?.status).toBe('escalated');
		// a weakened test makes a gate prove the wrong thing, so the refusal lands
		// before the gates rather than after them — not one gate command was paid
		// for at this checkpoint
		expect(checkpoint?.verification).toEqual(expect.objectContaining({ failedFamilies: ['test-review'] }));
		expect(checkpointGates).toStrictEqual([]);
		// whoever repairs it is told which file and why, without opening the run folder
		expect(result.error ?? '').toContain(ledgerFile);
		expect(result.error ?? '').toContain(refusalReason);
		// and the refusal is a verdict, not a revert: the engine left the tree exactly
		// as the executor wrote it
		expect(readFileSync(join(dir, ledgerFile), 'utf8')).toBe(correctedBody);
	});

	test('verify: a moved ledger test file is proven under its new path when the reviewer records the move', async () => {
		const { dir, driver, config } = await setupReviewRun({
			movedTo: movedFile,
			verdicts: movedVerdict,
			// the suite reports the case only at its destination, so a mapping that
			// stayed at the old path could not be proven at all
			evidence: [{ file: movedFile, name: ledgerTestName }],
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		expect(result.ok).toBe(true);
		// the move happened for real — the source is gone and the destination
		// carries the case
		expect(existsSync(join(dir, ledgerFile))).toBe(false);
		expect(readFileSync(join(dir, movedFile), 'utf8')).toContain(ledgerTestName);
		// the disposition rewrote the mapping's file and left its criterion, name
		// and gate alone, so the row is proven under the path it now carries
		expect(result.manifest.acceptanceTests).toStrictEqual([{ criterion, testFile: movedFile, testName: ledgerTestName, gate: 'test' }]);
	});

	test('implement: the approved copies are removed when the run passes and kept when it stops', async () => {
		const passing = await setupReviewRun({ executorEdit: correctedBody, verdicts: keptVerdict });

		const passed = await runImplementPipeline({ cwd: passing.dir, driver: passing.driver, config: passing.config, planPath: 'plan.md', skipRefactor: true });

		// the copies are the working baseline, not the evidence: a run with every
		// step green needs no baseline to diff against any more
		expect(passed.ok).toBe(true);
		expect(existsSync(approvedDir({ dir: passing.dir, runId: passed.manifest.runId }))).toBe(false);

		const stopping = await setupReviewRun({ executorEdit: correctedBody, verdicts: refusedVerdict });

		const stopped = await runImplementPipeline({
			cwd: stopping.dir,
			driver: stopping.driver,
			config: stopping.config,
			planPath: 'plan.md',
			skipRefactor: true,
		});

		// a stopped run keeps them, so a resume re-reviews the same change against
		// the same baseline — the bytes the ledger writer left, untouched by the
		// edit that was refused
		expect(stopped.ok).toBe(false);
		expect(readFileSync(join(approvedDir({ dir: stopping.dir, runId: stopped.manifest.runId }), ledgerFile), 'utf8')).toBe(bodyOf({ names: [ledgerTestName] }));
	});
});
