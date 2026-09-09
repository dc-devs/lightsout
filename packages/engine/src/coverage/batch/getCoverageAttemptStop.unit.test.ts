import { describe, expect, test } from '@jest/globals';
import { BatchOutcome, type CoverageBatchReport, type WorkReport } from '#src/contracts/index.ts';
import { getCoverageAttemptStop } from '#src/coverage/batch/getCoverageAttemptStop.ts';
import { CoverageBatchStopKind } from '#src/coverage/common/constants/CoverageBatchStopKind.ts';
import type { CoverageBatch } from '#src/coverage/common/types/CoverageBatch.ts';
import type { CoverageBatchStop } from '#src/coverage/common/types/CoverageBatchStop.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';

const batch: CoverageBatch = {
	id: 'batch-01:root',
	scope: 'root',
	files: [{ path: 'src/target.ts', scope: 'root', statementsPct: 40 }],
	members: ['src/target.ts'],
};

const setupCoverageAttempt = ({
	attempt,
	improved = true,
	gateResult,
}: {
	attempt: AgentOutcome<WorkReport>;
	/** Whether the re-measure saw a tracked file's statements percentage rise. */
	improved?: boolean;
	/** What the gates answered when consulted for the salvage check. */
	gateResult: GateRunResult;
}) => {
	const rationale: string[] = [];
	const progress: string[] = [];
	const finished: { outcome: BatchOutcome; files: CoverageBatchReport['files'] }[] = [];
	const doneStop: CoverageBatchStop = {
		kind: CoverageBatchStopKind.Done,
		report: { outcome: BatchOutcome.Resolved, files: [], rationale: [] },
		changedFiles: [],
	};

	return {
		rationale,
		progress,
		finished,
		doneStop,
		run: () =>
			getCoverageAttemptStop({
				batchId: 'batch-01:root',
				batch,
				attempt,
				rationale,
				onProgress: (message: string) => progress.push(message),
				testsOnly: async () => undefined,
				measure: async () => ({
					files: [{ path: 'src/target.ts', beforePct: 40, afterPct: improved ? 80 : 40 }],
					improved,
				}),
				gates: async () => gateResult,
				finish: (params: { outcome: BatchOutcome; files: CoverageBatchReport['files'] }) => {
					finished.push(params);

					return doneStop;
				},
			}),
	};
};

describe('getCoverageAttemptStop', () => {
	test('getCoverageAttemptStop: coverage that moved is not salvaged on a gate run that never got the machine', async () => {
		const { run, finished, rationale, progress } = setupCoverageAttempt({
			attempt: { ok: false, failure: 'laptop slept', rateLimited: false },
			improved: true,
			gateResult: {
				error: 'another run holds the machine',
				failedFamilies: [],
				crashes: [],
				coordination: 'another run holds the machine',
			},
		});

		const stop = await run();

		expect(stop).toStrictEqual({ kind: CoverageBatchStopKind.Failed, error: 'batch-01:root: laptop slept' });
		expect(finished).toStrictEqual([]);
		expect(rationale).toStrictEqual([]);
		expect(progress).toStrictEqual([]);
	});
});
