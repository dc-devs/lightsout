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

/** A complete WorkReport — this suite never varies its contents. */
const workReport = (): WorkReport => ({ status: WorkReportStatus.Complete, changedFiles: [], summary: 'stub', failures: [] });

/** One group per distinct subject file, so no group ever blocks another and only the writer ceiling can hold one back. */
const groupsOf = (count: number): TestTargetGroup[] =>
	Array.from({ length: count }, (_, index) => ({
		subjects: [`src/file${index}.ts`],
		mustExecute: [`src/file${index}.ts`],
	}));

/**
 * A PipelineRun stub that counts EVERY live writer invocation, the warm-up
 * writer included. The warm writer streams its first event and then stays
 * running for `warmDuration`, so the arrangement distinguishes a ceiling that
 * counts it from one that opens a full pool beside it.
 */
const setupSlotCounter = ({ warmDuration, writerDuration }: { warmDuration: number; writerDuration: number }) => {
	let inFlight = 0;
	let peak = 0;

	const runWriter = async ({ duration }: { duration: number }) => {
		inFlight += 1;
		peak = Math.max(peak, inFlight);

		await delay(duration);

		inFlight -= 1;

		return { ok: true, report: workReport() };
	};

	const run = {
		cwd: mkdtempSync(join(tmpdir(), 'lightsout-writer-slots-')),
		current: () => ({ runId: 'run-1' }),
		progress: () => undefined,
		invokeRole: async ({ onFirstEvent }: { onFirstEvent?: () => void }) => {
			if (onFirstEvent) {
				onFirstEvent();

				return runWriter({ duration: warmDuration });
			}

			return runWriter({ duration: writerDuration });
		},
	};

	return { run: run as unknown as PipelineRun, peak: () => peak };
};

// The slots refill the moment a writer settles rather than draining a batch at
// a time, so the ceiling is not structural — these two pin it. A scheduler that
// over-counts would spawn past the rate limit the constant exists to respect;
// one that under-counts would quietly serialize work it has slots for.
//
// Both expected peaks are written out rather than read from the constant. The
// arrangement may say "more groups than slots" in terms of the constant, but an
// assertion that moves with the value it is checking agrees with the code no
// matter what the code says.

test('runWriterBatches: holds at most 10 live writers with the warm-up writer counted among them', async () => {
	const { run, peak } = setupSlotCounter({ warmDuration: 60, writerDuration: 10 });
	const groupCount = testWriterConcurrency + 6;

	const { reports, failures, parked } = await runWriterBatches({ run, groups: groupsOf(groupCount), planContent: '# Plan' });

	expect({ peak: peak(), reports: reports.length, failures, parked }).toStrictEqual({
		peak: 10,
		reports: groupCount,
		failures: [],
		parked: false,
	});
});

test('runWriterBatches: opens a writer for every group when the groups are fewer than the slots', async () => {
	const { run, peak } = setupSlotCounter({ warmDuration: 60, writerDuration: 20 });

	const { reports, failures, parked } = await runWriterBatches({ run, groups: groupsOf(4), planContent: '# Plan' });

	expect({ peak: peak(), reports: reports.length, failures, parked }).toStrictEqual({
		peak: 4,
		reports: 4,
		failures: [],
		parked: false,
	});
});
