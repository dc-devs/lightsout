import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type LedgerRow, type LightsoutConfig, type RunManifest, RunStatus, type StepRecord, type WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import { ledgerCopyPath } from '#src/pipeline/common/utils/ledgerCopyPath.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { writeLedgerTestsStep } from '#src/pipeline/steps/writeLedgerTestsStep.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const testFile = 'src/widget.unit.test.js';
const first = 'widget: disabled renders nothing';
const second = 'widget: enabled renders its label';

const rowsFor = ({ names }: { names: string[] }): LedgerRow[] =>
	names.map((testName, index) => ({ criterion: `criterion ${index}`, testFile, testName, gate: 'test', line: 10 + index }));

/** A test file stating exactly the named cases. */
const fileWith = ({ names }: { names: string[] }) => `${names.map((name) => `test('${name}', () => {});`).join('\n')}\n`;

/**
 * A PipelineRun stub over a real git repo: writer invocations answer through
 * `respond`, which owns what lands on disk, and every stop is captured rather
 * than thrown.
 */
const setupLedgerRun = ({ cwd, format, respond }: { cwd: string; format?: string; respond: ({ prompt }: { prompt: string }) => WorkReport }) => {
	const manifest = { runId: 'run-1', changedFiles: [], packages: [], baselineDirtyFiles: [], ledgerTests: [] } as unknown as RunManifest;
	const prompts: string[] = [];
	const progress: string[] = [];
	let stopped: { status: RunStatus; error: string } | undefined;
	let record: StepRecord | undefined;

	const run = {
		cwd,
		config: { gates: { check: 'true', test: 'true', 'test-coverage': false, ...(format ? { format } : {}) } } as unknown as LightsoutConfig,
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

describe('writeLedgerTestsStep', () => {
	test('a writer that omits a named test is re-invoked once, with the missing names in its brief', async () => {
		const cwd = setupConsumerRepo();
		const { run, prompts, manifest, stopped } = setupLedgerRun({
			cwd,
			respond: ({ prompt }) => {
				writeFileSync(join(cwd, testFile), fileWith({ names: prompt.includes('# Missing tests') ? [first, second] : [first] }));

				return report();
			},
		});

		await writeLedgerTestsStep({ run, planContent: '# Plan', rows: rowsFor({ names: [first, second] }) })();

		// exactly one repair re-invocation, and it names the test that was missing
		expect(prompts.length).toBe(2);
		expect(prompts[1]?.includes('# Missing tests')).toBeTruthy();
		expect(prompts[1]?.includes(`- \`${second}\``)).toBeTruthy();
		// the repaired file is what gets locked
		expect(stopped()).toBe(undefined);
		expect(manifest.ledgerTests).toStrictEqual([
			{ path: testFile, testNames: [first, second], sha256: sha256({ content: fileWith({ names: [first, second] }) }) },
		]);
	});

	test('a test still missing after the repair pass stops the run failed, naming the file and the test', async () => {
		const cwd = setupConsumerRepo();
		const { run, prompts, manifest, stopped } = setupLedgerRun({
			cwd,
			respond: () => {
				writeFileSync(join(cwd, testFile), fileWith({ names: [first] }));

				return report();
			},
		});

		await writeLedgerTestsStep({ run, planContent: '# Plan', rows: rowsFor({ names: [first, second] }) })();

		// the writer got its one repair and still ignored the assignment
		expect(prompts.length).toBe(2);
		expect(stopped()?.status).toBe(RunStatus.Failed);
		expect(stopped()?.error.includes(testFile)).toBeTruthy();
		expect(stopped()?.error.includes(second)).toBeTruthy();
		// nothing is locked, because nothing states the criterion
		expect(manifest.ledgerTests).toStrictEqual([]);
	});

	test('a writer that reports complete but writes no file stops the run failed', async () => {
		const cwd = setupConsumerRepo();
		const { run, stopped } = setupLedgerRun({ cwd, respond: () => report({ changedFiles: [] }) });

		await writeLedgerTestsStep({ run, planContent: '# Plan', rows: rowsFor({ names: [first] }) })();

		// an absent file is not a repair case: there is nothing to add a case to
		expect(stopped()?.status).toBe(RunStatus.Failed);
		expect(stopped()?.error.includes('wrote no such file')).toBeTruthy();
	});

	test('a test name the committed file already carries stops the run before any writer spawns', async () => {
		// the file is planted before the repo's first commit, so HEAD carries it
		const cwd = setupConsumerRepo({ sources: { [testFile]: fileWith({ names: [first] }) } });
		const { run, prompts, stopped } = setupLedgerRun({ cwd, respond: () => report() });

		await writeLedgerTestsStep({ run, planContent: '# Plan', rows: rowsFor({ names: [first] }) })();

		// a test written for older behaviour must never be locked as a new
		// criterion's verifier, and no writer is paid for to discover that
		expect(prompts).toStrictEqual([]);
		expect(stopped()?.status).toBe(RunStatus.Failed);
		expect(stopped()?.error.includes(`${testFile}: ${first}`)).toBeTruthy();
	});

	test('a test name present only in the working tree is not treated as pre-existing', async () => {
		const cwd = setupConsumerRepo();

		// what a re-entry after a park looks like: the step's own first pass left
		// its file on disk, and HEAD still does not know about it
		writeFileSync(join(cwd, testFile), fileWith({ names: [first] }));

		const { run, prompts, manifest, stopped } = setupLedgerRun({
			cwd,
			respond: () => {
				writeFileSync(join(cwd, testFile), fileWith({ names: [first] }));

				return report();
			},
		});

		await writeLedgerTestsStep({ run, planContent: '# Plan', rows: rowsFor({ names: [first] }) })();

		expect(stopped()).toBe(undefined);
		// the writer ran, found its case present, and the step locked as on a
		// first pass
		expect(prompts.length).toBe(1);
		expect(manifest.ledgerTests.map((ledgerTest) => ledgerTest.path)).toStrictEqual([testFile]);
	});

	test('the hash and the copy are taken after the formatter ran', async () => {
		const cwd = setupConsumerRepo();
		const formatted = `${fileWith({ names: [first] })}// formatted\n`;
		const { run, manifest } = setupLedgerRun({
			cwd,
			format: `printf '// formatted\\n' >> ${testFile}`,
			respond: () => {
				writeFileSync(join(cwd, testFile), fileWith({ names: [first] }));

				return report();
			},
		});

		await writeLedgerTestsStep({ run, planContent: '# Plan', rows: rowsFor({ names: [first] }) })();

		// the lock is byte-exact against formatted bytes, so every later format
		// pass is a no-op on a locked file
		expect(readFileSync(join(cwd, testFile), 'utf8')).toBe(formatted);
		expect(manifest.ledgerTests[0]?.sha256).toBe(sha256({ content: formatted }));
		expect(readFileSync(ledgerCopyPath({ cwd, runId: 'run-1', path: testFile }), 'utf8')).toBe(formatted);
	});

	test('a writer whose report is not complete stops the run without locking anything', async () => {
		const cwd = setupConsumerRepo();
		const { run, manifest, stopped } = setupLedgerRun({
			cwd,
			respond: () => report({ status: WorkReportStatus.Failed, failures: ['the plan states no signature for the widget'] }),
		});

		await writeLedgerTestsStep({ run, planContent: '# Plan', rows: rowsFor({ names: [first] }) })();

		// a row the plan cannot support is a plan defect, reported as one
		expect(stopped()?.status).toBe(RunStatus.Failed);
		expect(stopped()?.error.includes('the plan states no signature for the widget')).toBeTruthy();
		expect(manifest.ledgerTests).toStrictEqual([]);
	});
});
