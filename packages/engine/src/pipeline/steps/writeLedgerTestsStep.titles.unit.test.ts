import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type LedgerRow, type LightsoutConfig, type RunManifest, RunStatus, type StepRecord, type WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { writeLedgerTestsStep } from '#src/pipeline/steps/writeLedgerTestsStep.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const testFile = 'src/widget.unit.test.js';
const assigned = 'widget: disabled renders nothing';

const rowsFor = ({ names }: { names: string[] }): LedgerRow[] =>
	names.map((testName, index) => ({ criterion: `criterion ${index}`, testFile, testName, gate: 'test', line: 10 + index }));

/**
 * The assigned name everywhere a quoted-string search would find it, and
 * nowhere a test call head states it: a comment, a `describe` block and a
 * variable.
 */
const fileQuotingOnly = ({ name }: { name: string }) =>
	[`// TODO: '${name}'`, `const label = '${name}';`, `describe('${name}', () => {`, `\ttest('some other case', () => {});`, '});', ''].join('\n');

/** The assigned name as a real test call head, under the same decoys. */
const fileStating = ({ name }: { name: string }) => `${fileQuotingOnly({ name })}test('${name}', () => {});\n`;

/**
 * A PipelineRun stub over a real git repo: writer invocations answer through
 * `respond`, which owns what lands on disk, and every stop is captured rather
 * than thrown.
 */
const setupLedgerRun = ({ cwd, respond }: { cwd: string; respond: ({ prompt }: { prompt: string }) => WorkReport }) => {
	const manifest = { runId: 'run-1', changedFiles: [], packages: [], baselineDirtyFiles: [], acceptanceTests: [], approvedTests: [] } as unknown as RunManifest;
	const prompts: string[] = [];
	const progress: string[] = [];
	let stopped: { status: RunStatus; error: string } | undefined;
	let record: StepRecord | undefined;

	const run = {
		cwd,
		config: { gates: { check: 'true', test: 'true', 'test-coverage': false } } as unknown as LightsoutConfig,
		current: () => manifest,
		progress: (message: string) => progress.push(message),
		parkMessage: () => 'run parked',
		nextRecord: ({ id }: { id: string }) => ({ id, status: RunStatus.Running, attempts: 1 }),
		setStep: async ({ patch, record: next }: { record: StepRecord; patch?: Partial<RunManifest> }) => {
			record = next;
			Object.assign(manifest, patch ?? {});
		},
		stop: async ({ status, error }: { status: RunStatus; error: string }) => {
			stopped = { status, error };

			return { ok: false as const, manifest, error };
		},
		invokeRole: async ({ invocation }: { invocation: { prompt: string } }) => {
			prompts.push(invocation.prompt);

			return { ok: true as const, report: respond({ prompt: invocation.prompt }) };
		},
	};

	return { run: run as unknown as PipelineRun, manifest, prompts, progress, stopped: () => stopped, record: () => record };
};

const report = (overrides: Partial<WorkReport> = {}): WorkReport => ({
	status: WorkReportStatus.Complete,
	changedFiles: [{ path: testFile, summary: 'ledger tests' }],
	summary: 'stub',
	failures: [],
	...overrides,
});

/**
 * The committed file quotes the assigned name in a comment, a variable and a
 * `describe` head, and the first writer pass leaves it that way. Both of the
 * step's identity checks are therefore asked about the same file: the
 * committed-conflict check before any writer spawns, and the presence check
 * after the first pass.
 */
const setupQuotedDecoys = () => {
	const cwd = setupConsumerRepo({ sources: { [testFile]: fileQuotingOnly({ name: assigned }) } });
	const { run, manifest, prompts, stopped } = setupLedgerRun({
		cwd,
		respond: ({ prompt }) => {
			writeFileSync(join(cwd, testFile), prompt.includes('# Missing tests') ? fileStating({ name: assigned }) : fileQuotingOnly({ name: assigned }));

			return report();
		},
	});

	return { run, manifest, prompts, stopped };
};

const alsoAssigned = 'widget: enabled renders its label';
const movedTo = 'src/widget/widget.unit.test.js';

/** A test file stating exactly the named cases, and nothing a decoy would add. */
const fileOf = ({ names }: { names: string[] }) => `${names.map((name) => `test('${name}', () => {});`).join('\n')}\n`;

/** Where the run keeps the approved copy of one test-side file. Spelled out rather than imported, so the test states the path the run promises. */
const approvedCopy = ({ cwd, path }: { cwd: string; path: string }) => join(cwd, '.lightsout', 'runs', 'run-1', 'approved', path);

const hashOf = ({ content }: { content: string }) => createHash('sha256').update(content).digest('hex');

/**
 * A run whose writer states every assigned name at once, with a formatter that
 * appends a line to the file it wrote. The manifest opens its acceptance
 * mapping and its approved records empty, which is the state a real run reaches
 * this step in.
 */
const setupApprovingRun = ({ names }: { names: string[] }) => {
	const cwd = setupConsumerRepo();
	const stub = setupLedgerRun({
		cwd,
		respond: () => {
			writeFileSync(join(cwd, testFile), fileOf({ names }));

			return report();
		},
	});

	Object.assign(stub.run.config.gates, { format: `printf '// formatted\\n' >> ${testFile}` });
	Object.assign(stub.manifest, { acceptanceTests: [], approvedTests: [] });

	return { ...stub, cwd, formatted: `${fileOf({ names })}// formatted\n` };
};

/**
 * HEAD carries the move's source stating the assigned name, nothing sits at the
 * move's destination, and the ledger names the destination for that same test —
 * the bypass the committed-conflict check has to see through.
 */
const setupMovedLedgerRun = () => {
	const cwd = setupConsumerRepo({ sources: { [testFile]: fileOf({ names: [assigned] }) } });
	const stub = setupLedgerRun({ cwd, respond: () => report() });

	return {
		...stub,
		rows: [{ criterion: 'criterion 0', testFile: movedTo, testName: assigned, gate: 'test', line: 10 }] as LedgerRow[],
		movePaths: [{ from: testFile, to: movedTo }],
	};
};

describe('writeLedgerTestsStep', () => {
	test('write-ledger-tests: judges a name by its test call head, not by a quoted string anywhere in the file', async () => {
		const { run, manifest, prompts, stopped } = setupQuotedDecoys();

		await writeLedgerTestsStep({ run, planContent: '# Plan', rows: rowsFor({ names: [assigned] }) })();

		// the committed file quotes the name but heads no test call with it, so
		// the step does not refuse the plan: the first writer is spawned
		expect(prompts.length).toBe(2);
		// the first pass left the same quoted decoys, which the presence check
		// reads as the named test being absent — one repair, naming it
		expect(prompts[1]).toContain('# Missing tests');
		expect(prompts[1]).toContain(`- \`${assigned}\``);
		// the repaired file states the name as a test call head, so the step
		// settles green and approves it
		expect(stopped()).toBe(undefined);
		expect(manifest.approvedTests.map((record) => record.path)).toStrictEqual([testFile]);
		expect(manifest.acceptanceTests.map((record) => record.testName)).toStrictEqual([assigned]);
	});

	test('write-ledger-tests: seeds the acceptance mapping from the ledger and approves every file it wrote after formatting', async () => {
		const { run, manifest, cwd, formatted, stopped } = setupApprovingRun({ names: [assigned, alsoAssigned] });

		await writeLedgerTestsStep({ run, planContent: '# Plan', rows: rowsFor({ names: [assigned, alsoAssigned] }), movePaths: [], deletePaths: [] })();

		expect(stopped()).toBe(undefined);
		// one record per ledger row, carrying the four fields a checkpoint proves a
		// row by — this is the live mapping a later disposition rewrites
		expect(manifest.acceptanceTests).toStrictEqual([
			{ criterion: 'criterion 0', testFile, testName: assigned, gate: 'test' },
			{ criterion: 'criterion 1', testFile, testName: alsoAssigned, gate: 'test' },
		]);
		// the approval is of formatted bytes, so the first checkpoint's diff against
		// this baseline is empty rather than the formatter's own edit
		expect(manifest.approvedTests).toStrictEqual([{ path: testFile, sha256: hashOf({ content: formatted }), removed: false }]);
		expect(readFileSync(approvedCopy({ cwd, path: testFile }), 'utf8')).toBe(formatted);
	});

	test("write-ledger-tests: a name the move's source already holds at HEAD is refused for the destination", async () => {
		const { run, prompts, rows, movePaths, stopped } = setupMovedLedgerRun();

		await writeLedgerTestsStep({ run, planContent: '# Plan', rows, movePaths, deletePaths: [] })();

		// the destination is untracked at HEAD, so reading it directly would answer
		// "nothing committed" and let a test written for older behaviour be named as
		// a new criterion's verifier simply by moving its file
		expect(stopped()?.status).toBe(RunStatus.Failed);
		expect(stopped()?.error).toContain(`${movedTo}: ${assigned}`);
		// and no writer is paid for to discover it
		expect(prompts).toStrictEqual([]);
	});
});
