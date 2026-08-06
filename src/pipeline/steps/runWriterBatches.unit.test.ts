import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { setTimeout as delay } from 'node:timers/promises';
import { WorkReportStatus, type WorkReport } from '@/contracts';
import type { PipelineRun } from '@/pipeline/PipelineRun';
import { runWriterBatches } from '@/pipeline/steps/runWriterBatches';

/** A complete WorkReport with per-test overrides. */
const workReport = (overrides: Partial<WorkReport> = {}): WorkReport => ({
	status: WorkReportStatus.Complete,
	changedFiles: [],
	summary: 'stub',
	failures: [],
	...overrides,
});

/** What a stubbed writer invocation returns — the invokeRole outcome fields runWriterBatches reads. */
interface Outcome {
	report?: WorkReport;
	failure?: string;
	rateLimited?: boolean;
}

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

const groupsOf = (count: number) => Array.from({ length: count }, (unused, index) => [`src/file${index}.ts`]);

test('runWriterBatches: the held-back writers start as soon as the warm spawn streams its first event — not when it finishes', async () => {
	const { run, log } = setupRun({
		respond: async ({ file, onFirstEvent, log: events }) => {
			if (onFirstEvent) {
				events.push(`event:${file}`);
				onFirstEvent();
				await delay(20);
			}

			return { report: workReport() };
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
	const { run, log } = setupRun({ respond: async () => ({ report: workReport() }) });

	const { reports, failures, parked } = await runWriterBatches({ run, groups: groupsOf(3), planContent: '# Plan' });

	expect(parked).toBe(false);
	expect(failures).toStrictEqual([]);
	// no writer is stranded behind an event that never comes
	expect(reports.length).toBe(3);
	// the rest wait for the warm spawn to settle
	expect(log.indexOf('end:src/file0.ts') < log.indexOf('start:src/file1.ts')).toBeTruthy();
});

test('runWriterBatches: zero groups return empty aggregates without spawning a writer', async () => {
	const { run, log } = setupRun({ respond: async () => ({ report: workReport() }) });

	const outcome = await runWriterBatches({ run, groups: [], planContent: '# Plan' });

	expect(outcome).toStrictEqual({ reports: [], failures: [], terminated: false, parked: false });
	// no writer was spawned
	expect(log).toStrictEqual([]);
});

test('runWriterBatches: a single group runs ungated — there is nothing to warm for', async () => {
	const { run, gated } = setupRun({ respond: async () => ({ report: workReport() }) });

	const { reports } = await runWriterBatches({ run, groups: groupsOf(1), planContent: '# Plan' });

	expect(reports.length).toBe(1);
	// the lone writer is spawned without a first-event gate
	expect(gated).toStrictEqual([false]);
});

test('runWriterBatches: a rate limit in a released batch parks the run and the warm report is still collected', async () => {
	const { run } = setupRun({
		respond: async ({ file, onFirstEvent }) => {
			if (onFirstEvent) {
				onFirstEvent();

				return { report: workReport({ summary: 'warm' }) };
			}

			return file === 'src/file1.ts' ? { rateLimited: true } : { report: workReport() };
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
		respond: async ({ onFirstEvent }) => (onFirstEvent ? { rateLimited: true } : { report: workReport() }),
	});

	const { reports, parked } = await runWriterBatches({ run, groups: groupsOf(3), planContent: '# Plan' });

	expect(parked).toBe(true);
	// nothing else was spawned to report
	expect(reports).toStrictEqual([]);
	// the batches never launched
	expect(log).toStrictEqual(['start:src/file0.ts', 'end:src/file0.ts']);
});

test('runWriterBatches: a warm spawn that rate-limits after streaming stops the batches that have not started', async () => {
	const { run, log } = setupRun({
		respond: async ({ onFirstEvent }) => {
			if (onFirstEvent) {
				onFirstEvent();
				await delay(5);

				return { rateLimited: true };
			}

			await delay(30);

			return { report: workReport() };
		},
	});

	// 7 groups: one warm spawn, then two released batches of 5 and 1.
	const { reports, parked } = await runWriterBatches({ run, groups: groupsOf(7), planContent: '# Plan' });

	expect(parked).toBe(true);
	// the in-flight batch finished; the next one never started
	expect(reports.length).toBe(5);
	// the last group was never spawned
	expect(log.includes('start:src/file6.ts')).toBeFalsy();
});

test('runWriterBatches: complete, failed, and absent reports aggregate exactly as the step expects', async () => {
	const { run } = setupRun({
		respond: async ({ file }) => {
			if (file === 'src/file1.ts') {
				return { report: workReport({ status: WorkReportStatus.Failed, failures: ['bad assertion'] }) };
			}

			if (file === 'src/file2.ts') {
				return { failure: 'driver exploded' };
			}

			if (file === 'src/file3.ts') {
				return { report: workReport({ status: WorkReportStatus.TerminatedAmbiguity, failures: ['unclear plan'] }) };
			}

			return { report: workReport() };
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
