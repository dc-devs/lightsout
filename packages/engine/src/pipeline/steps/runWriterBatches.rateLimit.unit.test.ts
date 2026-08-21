import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from '@jest/globals';
import { type WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import { testWriterConcurrency } from '#src/pipeline/common/constants/testWriterConcurrency.ts';
import type { TestTargetGroup } from '#src/pipeline/common/types/TestTargetGroup.ts';
import { runWriterBatches } from '#src/pipeline/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

// What a writer's failure does to the fan-out around it. A rate limit is not a
// step failure: it parks the run so a human can resume it, which means every
// group still waiting for a slot must never spawn — and every writer already in
// flight must still be accounted for. An ordinary failure is the contrast case:
// it takes down nothing but its own chain.

// The fan-out's scenarios are split by concern, and each suite arranges its own
// writers. The stub below is restated per suite deliberately: a fixture reached
// across module lines would have to import this module's internals from outside
// it, and the barrel is not the place to publish a type only a test names.

/** A complete WorkReport with per-test overrides. */
const workReport = (overrides: Partial<WorkReport> = {}): WorkReport => ({
	status: WorkReportStatus.Complete,
	changedFiles: [],
	summary: 'stub',
	failures: [],
	...overrides,
});

/** What a stubbed writer invocation returns — the invokeRole outcome runWriterBatches reads. */
type Outcome = { ok: true; report: WorkReport } | { ok: false; failure: string; rateLimited: boolean };

/** A writer that answered with a report. */
const answered = (report: WorkReport): Outcome => ({ ok: true, report });

/** A writer that parked on the harness rate limit. */
const rateLimitedOutcome = (): Outcome => ({ ok: false, failure: 'harness rate limited or overloaded', rateLimited: true });

/**
 * A PipelineRun stub that records an ordered event log: `start:<file>` when a
 * writer spawns, `event:<file>` when it streams its first event, `end:<file>`
 * when it resolves. `respond` decides each writer's behavior by target file.
 */
const setupWriterRun = ({ respond }: { respond: (params: { file: string; onFirstEvent?: () => void; log: string[] }) => Promise<Outcome> }) => {
	const log: string[] = [];
	const gated: (boolean | undefined)[] = [];

	const run = {
		cwd: mkdtempSync(join(tmpdir(), 'lightsout-writers-')),
		current: () => ({ runId: 'run-1' }),
		progress: () => undefined,
		invokeRole: async ({ invocation, onFirstEvent }: { invocation: { prompt: string }; onFirstEvent?: () => void }) => {
			const file = /- (\S+)/.exec(invocation.prompt)?.[1] ?? 'unknown';

			gated.push(onFirstEvent !== undefined);
			log.push(`start:${file}`);

			const outcome = await respond({ file, onFirstEvent, log });

			log.push(`end:${file}`);

			return outcome;
		},
	};

	return { run: run as unknown as PipelineRun, log, gated };
};

/** One group per cluster, so every group becomes a chain competing for a slot. */
const groupsOf = (count: number): TestTargetGroup[] =>
	Array.from({ length: count }, (_, index) => ({
		subjects: [`src/file${index}.ts`],
		mustExecute: [`src/file${index}.ts`],
		cluster: `#${index}`,
	}));

test('runWriterBatches: a rate limit in a released batch parks the run and the warm report is still collected', async () => {
	const { run } = setupWriterRun({
		respond: async ({ file, onFirstEvent }) => {
			if (onFirstEvent) {
				onFirstEvent();

				return answered(workReport({ summary: 'warm' }));
			}

			return file === 'src/file1.ts' ? rateLimitedOutcome() : answered(workReport());
		},
	});

	const { reports, parked } = await runWriterBatches({ run, groups: groupsOf(3), planContent: '# Plan' });

	// the rate limit parks the run
	expect(parked).toBe(true);
	// the warm spawn's work is never dropped by a later park
	expect(reports.some((report) => report.summary === 'warm')).toBeTruthy();
});

test('runWriterBatches: a warm spawn that rate-limits before streaming stops every remaining group', async () => {
	const { run, log } = setupWriterRun({
		respond: async ({ onFirstEvent }) => (onFirstEvent ? rateLimitedOutcome() : answered(workReport())),
	});

	const { reports, parked } = await runWriterBatches({ run, groups: groupsOf(3), planContent: '# Plan' });

	expect(parked).toBe(true);
	// nothing else was spawned to report
	expect(reports).toStrictEqual([]);
	// the batches never launched
	expect(log).toStrictEqual(['start:src/file0.ts', 'end:src/file0.ts']);
});

test('runWriterBatches: a warm spawn that rate-limits after streaming stops the groups still waiting for a slot', async () => {
	const { run, log } = setupWriterRun({
		respond: async ({ onFirstEvent }) => {
			if (onFirstEvent) {
				onFirstEvent();
				await delay(5);

				return rateLimitedOutcome();
			}

			await delay(30);

			return answered(workReport());
		},
	});

	// One warm spawn, then more chains than there are slots — so some are still
	// queued when the warm spawn's rate limit lands and parks the run.
	const queued = 3;
	const { reports, parked } = await runWriterBatches({ run, groups: groupsOf(testWriterConcurrency + queued + 1), planContent: '# Plan' });

	expect(parked).toBe(true);
	// every slot that had already opened ran to completion — the count is written
	// out, because reading it from the constant the code reads would agree with a
	// cursor that opened the wrong number of slots
	expect(reports.length).toBe(10);
	// nothing waiting for a slot was ever spawned
	expect(log.includes(`start:src/file${testWriterConcurrency + queued}.ts`)).toBeFalsy();
});

test('runWriterBatches: a warm spawn that rate-limits after streaming abandons the rest of its own cluster, not the others', async () => {
	const { run, log } = setupWriterRun({
		respond: async ({ onFirstEvent }) => {
			if (onFirstEvent) {
				onFirstEvent();
				await delay(20);

				return rateLimitedOutcome();
			}

			return answered(workReport());
		},
	});
	// The warm spawn IS the first cluster's first chunk, so its rate limit has
	// to stop the chunk queued behind it — an unrelated cluster released by the
	// same first event has nothing to do with that limit and still runs.
	const groups: TestTargetGroup[] = [
		{ subjects: ['src/a1.ts'], mustExecute: ['src/a1.ts'], cluster: '#a' },
		{ subjects: ['src/a2.ts'], mustExecute: ['src/a2.ts'], cluster: '#a' },
		{ subjects: ['src/b.ts'], mustExecute: ['src/b.ts'], cluster: '#b' },
	];

	const { reports, parked } = await runWriterBatches({ run, groups, planContent: '# Plan' });

	expect(parked).toBe(true);
	// the trailing chunk of the rate-limited cluster is never spawned
	expect(log.includes('start:src/a2.ts')).toBeFalsy();
	// the unrelated cluster ran and its report is kept
	expect(log.includes('start:src/b.ts')).toBeTruthy();
	expect(reports.length).toBe(1);
});

test('runWriterBatches: a warm spawn that fails without rate-limiting leaves the rest of its own cluster free to run', async () => {
	const { run, log } = setupWriterRun({
		respond: async ({ onFirstEvent }) => {
			if (onFirstEvent) {
				onFirstEvent();

				return { ok: false, failure: 'driver exploded', rateLimited: false };
			}

			return answered(workReport());
		},
	});
	// Only a rate limit stops a cluster's chain. A plain failure is recorded
	// and the chunk queued behind it still gets its writer.
	const groups: TestTargetGroup[] = [
		{ subjects: ['src/a1.ts'], mustExecute: ['src/a1.ts'], cluster: '#a' },
		{ subjects: ['src/a2.ts'], mustExecute: ['src/a2.ts'], cluster: '#a' },
	];

	const { reports, failures, parked } = await runWriterBatches({ run, groups, planContent: '# Plan' });

	// a plain failure never parks the run
	expect(parked).toBe(false);
	// the trailing chunk of the failed cluster still ran
	expect(log.includes('start:src/a2.ts')).toBeTruthy();
	// the failed warm spawn contributed no report, only a failure
	expect(reports.length).toBe(1);
	expect(failures).toStrictEqual(['src/a1.ts: driver exploded']);
});

test('runWriterBatches: a rate limit inside one open slot stops the chains still queued behind it', async () => {
	// The park comes from a released chain here, not the warm spawn.
	const limited = 'src/file1.ts';
	const { run, log } = setupWriterRun({
		respond: async ({ file, onFirstEvent }) => {
			if (onFirstEvent) {
				onFirstEvent();
			}

			await delay(file === limited ? 5 : 200);

			return file === limited ? rateLimitedOutcome() : answered(workReport());
		},
	});

	const queued = 3;
	const { reports, failures, parked } = await runWriterBatches({ run, groups: groupsOf(testWriterConcurrency + queued + 1), planContent: '# Plan' });

	expect(parked).toBe(true);
	// a rate limit parks; it is never also a step failure
	expect(failures).toStrictEqual([]);
	// nothing waiting for a slot was ever spawned
	expect(log.includes(`start:src/file${testWriterConcurrency + queued}.ts`)).toBeFalsy();
	// the warm spawn plus every opened slot, minus the one that rate-limited —
	// written out for the same reason as above
	expect(reports.length).toBe(10);
});
