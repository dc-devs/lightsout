import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, test } from '@jest/globals';
import { type WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import { testWriterConcurrency } from '#src/pipeline/common/constants/testWriterConcurrency.ts';
import type { TestTargetGroup } from '#src/pipeline/common/types/TestTargetGroup.ts';
import { runWriterBatches } from '#src/pipeline/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

/** A complete WorkReport — this suite never varies its contents. */
const workReport = (): WorkReport => ({ status: WorkReportStatus.Complete, changedFiles: [], summary: 'stub', failures: [] });

/** One group per cluster, so every group becomes a chain competing for a slot. */
const groupsOf = (count: number): TestTargetGroup[] =>
	Array.from({ length: count }, (_, index) => ({
		subjects: [`src/file${index}.ts`],
		mustExecute: [`src/file${index}.ts`],
		cluster: `#${index}`,
	}));

/**
 * A PipelineRun stub that counts how many writers are running at the same
 * moment. The warm spawn settles the instant it streams, so the peak below
 * counts only the writers holding one of the fan-out's slots.
 */
const setupSlotCounter = () => {
	let inFlight = 0;
	let peak = 0;

	const run = {
		cwd: mkdtempSync(join(tmpdir(), 'lightsout-writer-slots-')),
		current: () => ({ runId: 'run-1' }),
		progress: () => undefined,
		invokeRole: async ({ onFirstEvent }: { onFirstEvent?: () => void }) => {
			if (onFirstEvent) {
				onFirstEvent();

				return { ok: true, report: workReport() };
			}

			inFlight += 1;
			peak = Math.max(peak, inFlight);

			await delay(10);

			inFlight -= 1;

			return { ok: true, report: workReport() };
		},
	};

	return { run: run as unknown as PipelineRun, peak: () => peak };
};

describe('runWriterBatches', () => {
	// The slots refill from a shared cursor rather than draining a batch at a
	// time, so the ceiling is no longer structural — these pin it. A cursor that
	// over-counts would spawn past the rate limit the constant exists to respect;
	// one that under-counts would quietly serialize the fan-out.
	//
	// The expected peak is written out rather than read from the constant. The
	// arrangement may say "more groups than slots" in terms of the constant, but
	// an assertion that moves with the value it is checking agrees with the code
	// no matter what the code says.
	test.each([
		{ what: 'more chains queued than slots', groupCount: testWriterConcurrency + 6, expectedPeak: 10 },
		{ what: 'fewer chains queued than slots', groupCount: 4, expectedPeak: 3 },
	])('holds $expectedPeak writers at once with $what, and still reports every group', async ({ groupCount, expectedPeak }) => {
		const { run, peak } = setupSlotCounter();

		const { reports, failures, parked } = await runWriterBatches({ run, groups: groupsOf(groupCount), planContent: '# Plan' });

		expect({ peak: peak(), reports: reports.length, failures, parked }).toStrictEqual({
			peak: expectedPeak,
			reports: groupCount,
			failures: [],
			parked: false,
		});
	});
});
