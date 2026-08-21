import { maxConsecutiveDeclines } from '#src/common/constants/maxConsecutiveDeclines.ts';
import { BatchOutcome, CoverageBatchReport, RunStatus, type StepRecord } from '#src/contracts/index.ts';
import type { CoverageResult } from '#src/coverage/CoverageResult.ts';
import type { CoverageRun } from '#src/coverage/CoverageRun.ts';
import { CoverageBatchStopKind } from '#src/coverage/common/constants/CoverageBatchStopKind.ts';
import { maxFileStrikes } from '#src/coverage/common/constants/maxFileStrikes.ts';
import type { CoverageBatch } from '#src/coverage/common/types/CoverageBatch.ts';
import type { CoverageBatchStop } from '#src/coverage/common/types/CoverageBatchStop.ts';
import { updateFileStrikes } from '#src/coverage/common/utils/updateFileStrikes.ts';

interface Params {
	run: CoverageRun;
	batch: CoverageBatch;
	/** The batch's in-flight step record, to be closed out with the outcome. */
	record: StepRecord;
	outcome: CoverageBatchStop;
	/** Consecutive declines up to and excluding this batch. */
	declineStreak: number;
	/** Per-file no-improvement strikes across the run's resolved batches (path → count). */
	fileStrikes: Map<string, number>;
}

interface CoverageSettlement {
	/** Present when this batch ends the whole run — park, failure, escalation. */
	result?: CoverageResult;
	/** The streak carried into the next round. */
	declineStreak: number;
}

/**
 * Turn one coverage batch's terminal condition into persisted run state: a
 * park, a failure, or an escalation ends the run, while a completed batch
 * records its report and its tests.
 *
 * A declined batch is still a Passed step — its outcome and files are written
 * before the run escalates, so resume never re-spends on it — and three
 * consecutive declines stop the run as systemic rather than a per-batch
 * judgment. A resolved batch pays the free-rider guard instead: a file carried
 * through improving batches without improving is set aside on its own.
 */
export const settleCoverageBatch = async ({ run, batch, record, outcome, declineStreak, fileStrikes }: Params): Promise<CoverageSettlement> => {
	if (outcome.kind === CoverageBatchStopKind.Parked) {
		const error = `run parked: harness rate limited or overloaded — resume with \`lightsout test-coverage-to-threshold --run ${run.current().runId}\` when the window resets.`;

		return { result: await run.stop({ record, status: RunStatus.PausedRateLimit, error }), declineStreak };
	}

	if (outcome.kind === CoverageBatchStopKind.Failed || outcome.kind === CoverageBatchStopKind.Escalated) {
		const status = outcome.kind === CoverageBatchStopKind.Failed ? RunStatus.Failed : RunStatus.Escalated;

		return { result: await run.stop({ record, status, error: outcome.error }), declineStreak };
	}

	const report = CoverageBatchReport.parse(outcome.report);

	await run.setStep({
		record: { ...record, status: RunStatus.Passed, report, changedFiles: outcome.changedFiles },
		patch: { changedFiles: [...new Set([...run.current().changedFiles, ...outcome.changedFiles])] },
	});

	const settlement: CoverageSettlement = { declineStreak: 0 };

	if (report.outcome !== BatchOutcome.Declined) {
		const struck = updateFileStrikes({ batchId: batch.id, files: report.files, fileStrikes });

		run.setAside.push(...struck);

		for (const path of struck.flatMap((entry) => entry.files)) {
			run.progress(`${path}: set aside after ${maxFileStrikes} batches without improvement`);
		}

		run.progress(`${batch.id}: resolved`);
	} else {
		const streak = declineStreak + 1;

		settlement.declineStreak = streak;

		run.setAside.push({ batchId: batch.id, files: report.files.map((file) => file.path), rationale: report.rationale });
		run.progress(`${batch.id}: declined (${report.files.length} file(s) set aside)`);

		if (streak >= maxConsecutiveDeclines) {
			// The batch's Passed record is already written — only the RUN escalates,
			// so resume never re-spends on it.
			const error = `${maxConsecutiveDeclines} consecutive batches declined — likely systemic (standards injection, gate config, or untestable source), not worth further agent spend.`;

			await run.update({ patch: { status: RunStatus.Escalated, currentStep: null } });
			run.progress(`coverage run stopped after ${batch.id} — ${RunStatus.Escalated}`);
			settlement.result = run.buildHaltedResult({ error });
		}
	}

	return settlement;
};
