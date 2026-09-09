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

// The warm-up writer: when it releases the rest of the fan-out, what happens
// when it never streams or its driver dies, how few groups leave nothing to warm
// for, and that its report lands exactly once. Which groups may run beside each
// other is the suite next door; rate limits are the one after that.

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

/** One group per distinct subject file, so no group ever blocks another and only the warm-up gate can hold one back. */
const groupsOf = (count: number): TestTargetGroup[] =>
	Array.from({ length: count }, (_, index) => ({
		subjects: [`src/file${index}.ts`],
		mustExecute: [`src/file${index}.ts`],
	}));

test('runWriterBatches: the held-back writers start as soon as the warm spawn streams its first event — not when it finishes', async () => {
	const { run, log } = setupWriterRun({
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
	const { run, log } = setupWriterRun({ respond: async () => answered(workReport()) });

	const { reports, failures, parked } = await runWriterBatches({ run, groups: groupsOf(3), planContent: '# Plan' });

	expect(parked).toBe(false);
	expect(failures).toStrictEqual([]);
	// no writer is stranded behind an event that never comes
	expect(reports.length).toBe(3);
	// the rest wait for the warm spawn to settle
	expect(log.indexOf('end:src/file0.ts') < log.indexOf('start:src/file1.ts')).toBeTruthy();
});

test('runWriterBatches: zero groups return empty aggregates without spawning a writer', async () => {
	const { run, log } = setupWriterRun({ respond: async () => answered(workReport()) });

	const outcome = await runWriterBatches({ run, groups: [], planContent: '# Plan' });

	expect(outcome).toStrictEqual({ reports: [], failures: [], terminated: false, parked: false });
	// no writer was spawned
	expect(log).toStrictEqual([]);
});

test('runWriterBatches: a single group runs ungated — there is nothing to warm for', async () => {
	const { run, gated } = setupWriterRun({ respond: async () => answered(workReport()) });

	const { reports } = await runWriterBatches({ run, groups: groupsOf(1), planContent: '# Plan' });

	expect(reports.length).toBe(1);
	// the lone writer is spawned without a first-event gate
	expect(gated).toStrictEqual([false]);
});

test('runWriterBatches: a warm spawn whose driver throws surfaces the error instead of hanging on its first-event gate', async () => {
	const { run } = setupWriterRun({
		respond: async ({ onFirstEvent }) => {
			if (onFirstEvent) {
				throw new Error('harness crashed');
			}

			return answered(workReport());
		},
	});

	await expect(runWriterBatches({ run, groups: groupsOf(3), planContent: '# Plan' })).rejects.toThrow('harness crashed');
});

test('runWriterBatches: the warm report is folded in exactly once however many slots settle after it', async () => {
	// Every runner reaches the warm-collection point after the warm spawn settled.
	const { run } = setupWriterRun({
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
