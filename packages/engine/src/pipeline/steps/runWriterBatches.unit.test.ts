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
const setupRun = ({ respond }: { respond: (params: { file: string; onFirstEvent?: () => void; log: string[] }) => Promise<Outcome> }) => {
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

const groupsOf = (count: number): TestTargetGroup[] =>
	Array.from({ length: count }, (_, index) => ({
		subjects: [`src/file${index}.ts`],
		mustExecute: [`src/file${index}.ts`],
		cluster: `#${index}`,
	}));

test('runWriterBatches: the held-back writers start as soon as the warm spawn streams its first event — not when it finishes', async () => {
	const { run, log } = setupRun({
		respond: async ({ file, onFirstEvent, log: events }) => {
			if (onFirstEvent) {
				events.push(`event:${file}`);
				onFirstEvent();
				await delay(20);
			}

			return answered(workReport());
		},
	});

	const { reports, parked } = await runWriterBatches({ run, groups: groupsOf(3), planContent: '# Plan' });

	expect(parked).toBe(false);
	// every group produced a report
	expect(reports.length).toBe(3);
	// the batch waits for the warm spawn to stream
	expect(log.indexOf('event:src/file0.ts') < log.indexOf('start:src/file1.ts')).toBeTruthy();
	// but it does not wait for the warm spawn to finish
	expect(log.indexOf('start:src/file1.ts') < log.indexOf('end:src/file0.ts')).toBeTruthy();
});

test('runWriterBatches: a warm spawn that never streams an event releases the rest when it settles — the stub-driver path', async () => {
	const { run, log } = setupRun({ respond: async () => answered(workReport()) });

	const { reports, failures, parked } = await runWriterBatches({ run, groups: groupsOf(3), planContent: '# Plan' });

	expect(parked).toBe(false);
	expect(failures).toStrictEqual([]);
	// no writer is stranded behind an event that never comes
	expect(reports.length).toBe(3);
	// the rest wait for the warm spawn to settle
	expect(log.indexOf('end:src/file0.ts') < log.indexOf('start:src/file1.ts')).toBeTruthy();
});

test('runWriterBatches: zero groups return empty aggregates without spawning a writer', async () => {
	const { run, log } = setupRun({ respond: async () => answered(workReport()) });

	const outcome = await runWriterBatches({ run, groups: [], planContent: '# Plan' });

	expect(outcome).toStrictEqual({ reports: [], failures: [], terminated: false, parked: false });
	// no writer was spawned
	expect(log).toStrictEqual([]);
});

test('runWriterBatches: a single group runs ungated — there is nothing to warm for', async () => {
	const { run, gated } = setupRun({ respond: async () => answered(workReport()) });

	const { reports } = await runWriterBatches({ run, groups: groupsOf(1), planContent: '# Plan' });

	expect(reports.length).toBe(1);
	// the lone writer is spawned without a first-event gate
	expect(gated).toStrictEqual([false]);
});

test('runWriterBatches: groups sharing a cluster run one after another while distinct clusters stay parallel', async () => {
	const { run, log } = setupRun({
		respond: async ({ onFirstEvent }) => {
			if (onFirstEvent) {
				onFirstEvent();
				await delay(20);
			}

			return answered(workReport());
		},
	});
	// Two chunks of one oversized component (same cluster) plus one unrelated
	// group: the warm spawn is the first chunk, so its trailing chunk must wait
	// for it to settle — the unrelated group must not.
	const groups: TestTargetGroup[] = [
		{ subjects: ['src/a1.ts'], mustExecute: ['src/a1.ts'], cluster: '#a' },
		{ subjects: ['src/a2.ts'], mustExecute: ['src/a2.ts'], cluster: '#a' },
		{ subjects: ['src/b.ts'], mustExecute: ['src/b.ts'], cluster: '#b' },
	];

	const { reports, parked } = await runWriterBatches({ run, groups, planContent: '# Plan' });

	expect(parked).toBe(false);
	expect(reports.length).toBe(3);
	// the same-cluster chunk waits for its predecessor to settle
	expect(log.indexOf('end:src/a1.ts') < log.indexOf('start:src/a2.ts')).toBeTruthy();
	// the distinct cluster does not
	expect(log.indexOf('start:src/b.ts') < log.indexOf('end:src/a1.ts')).toBeTruthy();
});

test('runWriterBatches: a rate limit in a released batch parks the run and the warm report is still collected', async () => {
	const { run } = setupRun({
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
	const { run, log } = setupRun({
		respond: async ({ onFirstEvent }) => (onFirstEvent ? rateLimitedOutcome() : answered(workReport())),
	});

	const { reports, parked } = await runWriterBatches({ run, groups: groupsOf(3), planContent: '# Plan' });

	expect(parked).toBe(true);
	// nothing else was spawned to report
	expect(reports).toStrictEqual([]);
	// the batches never launched
	expect(log).toStrictEqual(['start:src/file0.ts', 'end:src/file0.ts']);
});

test('runWriterBatches: a freed slot takes the next group while a slow writer is still running', async () => {
	// One writer far slower than the rest. Under batching, nothing past the
	// first `testWriterConcurrency` groups could start until it returned; the
	// slots are meant to refill from the fast ones instead.
	const slow = 'src/file1.ts';
	const { run, log } = setupRun({
		respond: async ({ file, onFirstEvent }) => {
			if (onFirstEvent) {
				onFirstEvent();
			}

			await delay(file === slow ? 200 : 5);

			return answered(workReport());
		},
	});

	const queued = 2;
	const overflow = `src/file${testWriterConcurrency + queued}.ts`;
	const { reports } = await runWriterBatches({ run, groups: groupsOf(testWriterConcurrency + queued + 1), planContent: '# Plan' });

	expect(reports.length).toBe(testWriterConcurrency + queued + 1);
	// the queued group ran on a slot freed by a fast writer, not after the slow one
	expect(log.indexOf(`start:${overflow}`)).toBeLessThan(log.indexOf(`end:${slow}`));
});

test('runWriterBatches: a warm spawn that rate-limits after streaming stops the groups still waiting for a slot', async () => {
	const { run, log } = setupRun({
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
	// every slot that had already opened ran to completion
	expect(reports.length).toBe(testWriterConcurrency);
	// nothing waiting for a slot was ever spawned
	expect(log.includes(`start:src/file${testWriterConcurrency + queued}.ts`)).toBeFalsy();
});

test('runWriterBatches: complete, failed, and absent reports aggregate exactly as the step expects', async () => {
	const { run } = setupRun({
		respond: async ({ file }) => {
			if (file === 'src/file1.ts') {
				return answered(workReport({ status: WorkReportStatus.Failed, failures: ['bad assertion'] }));
			}

			if (file === 'src/file2.ts') {
				return { ok: false, failure: 'driver exploded', rateLimited: false };
			}

			if (file === 'src/file3.ts') {
				return answered(workReport({ status: WorkReportStatus.TerminatedAmbiguity, failures: ['unclear plan'] }));
			}

			return answered(workReport());
		},
	});

	const { reports, failures, terminated, parked } = await runWriterBatches({ run, groups: groupsOf(4), planContent: '# Plan' });

	expect(parked).toBe(false);
	// an absent report contributes no report
	expect(reports.length).toBe(3);
	expect(failures.includes('src/file1.ts: failed — bad assertion')).toBeTruthy();
	expect(failures.includes('src/file2.ts: driver exploded')).toBeTruthy();
	expect(failures.includes('src/file3.ts: terminated:ambiguity — unclear plan')).toBeTruthy();
	// a termination status escalates, a plain failure does not
	expect(terminated).toBe(true);
});

test('runWriterBatches: a warm spawn that rate-limits after streaming abandons the rest of its own cluster, not the others', async () => {
	const { run, log } = setupRun({
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
	const { run, log } = setupRun({
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

test('runWriterBatches: a warm spawn whose driver throws surfaces the error instead of hanging on its first-event gate', async () => {
	const { run } = setupRun({
		respond: async ({ onFirstEvent }) => {
			if (onFirstEvent) {
				throw new Error('harness crashed');
			}

			return answered(workReport());
		},
	});

	await expect(runWriterBatches({ run, groups: groupsOf(3), planContent: '# Plan' })).rejects.toThrow('harness crashed');
});

test('runWriterBatches: a rate limit inside one open slot stops the chains still queued behind it', async () => {
	// The park comes from a released chain here, not the warm spawn.
	const limited = 'src/file1.ts';
	const { run, log } = setupRun({
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
	// the warm spawn plus every opened slot, minus the one that rate-limited
	expect(reports.length).toBe(testWriterConcurrency);
});

test('runWriterBatches: the warm report is folded in exactly once however many slots settle after it', async () => {
	// Every runner reaches the warm-collection point after the warm spawn settled.
	const { run } = setupRun({
		respond: async ({ onFirstEvent }) => {
			if (onFirstEvent) {
				onFirstEvent();

				return answered(workReport({ summary: 'warm' }));
			}

			await delay(10);

			return answered(workReport());
		},
	});

	const { reports, parked } = await runWriterBatches({ run, groups: groupsOf(testWriterConcurrency + 1), planContent: '# Plan' });

	expect(parked).toBe(false);
	expect(reports.filter((report) => report.summary === 'warm').length).toBe(1);
	expect(reports.length).toBe(testWriterConcurrency + 1);
});
