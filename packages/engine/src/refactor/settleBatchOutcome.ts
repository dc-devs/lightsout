import { BatchOutcome, BatchReport, type RefactorBatch, RunStatus, type StepRecord } from '@/contracts';
import { BatchStopKind } from '@/refactor/common/constants/BatchStopKind';
import type { BatchStop } from '@/refactor/common/types/BatchStop';
import type { RefactorResult } from '@/refactor/RefactorResult';
import type { RefactorRun } from '@/refactor/RefactorRun';

const maxConsecutiveDeclines = 3;

interface Params {
	run: RefactorRun;
	batch: RefactorBatch;
	/** The batch's in-flight step record, to be closed out with the outcome. */
	record: StepRecord;
	outcome: BatchStop;
	/** Consecutive declines up to and excluding this batch. */
	declineStreak: number;
}

interface BatchSettlement {
	/** Present when this batch ends the whole run — park, failure, escalation. */
	result?: RefactorResult;
	/** The streak carried into the next batch. */
	declineStreak: number;
}

/**
 * Turn one batch's terminal condition into persisted run state: a park, a
 * failure, or an escalation ends the run, while a completed batch records its
 * report and changed files. A declined batch is still a Passed step — its
 * outcome and files are written before the run escalates, so resume never
 * re-spends on it — and three consecutive declines stop the run as systemic
 * rather than a per-batch judgment.
 */
export const settleBatchOutcome = async ({ run, batch, record, outcome, declineStreak }: Params): Promise<BatchSettlement> => {
	if (outcome.kind === BatchStopKind.Parked) {
		const error = `run parked: harness rate limited or overloaded — resume with \`lightsout refactor --run ${run.current().runId}\` when the window resets.`;

		return { result: await run.stop({ record, status: RunStatus.PausedRateLimit, error }), declineStreak };
	}

	if (outcome.kind === BatchStopKind.Failed || outcome.kind === BatchStopKind.Escalated) {
		const status = outcome.kind === BatchStopKind.Failed ? RunStatus.Failed : RunStatus.Escalated;

		return { result: await run.stop({ record, status, error: outcome.error }), declineStreak };
	}

	const report = BatchReport.parse(outcome.report);

	await run.setStep({
		record: { ...record, status: RunStatus.Passed, report, changedFiles: outcome.changedFiles },
		patch: { changedFiles: [...new Set([...run.current().changedFiles, ...outcome.changedFiles])] },
	});

	if (report.outcome !== BatchOutcome.Declined) {
		run.progress(`${batch.id}: resolved`);

		return { declineStreak: 0 };
	}

	const streak = declineStreak + 1;
	const settlement: BatchSettlement = { declineStreak: streak };

	run.declined.push({ batchId: batch.id, remainingSiteKeys: report.remainingSiteKeys, rationale: report.rationale });
	run.progress(`${batch.id}: declined (${report.remainingSiteKeys.length} site(s) persist)`);

	if (streak >= maxConsecutiveDeclines) {
		const error = `${maxConsecutiveDeclines} consecutive batches declined — likely systemic (standards injection, gate config, or a rule bug), not worth further agent spend.`;

		await run.update({ status: RunStatus.Escalated, currentStep: null });
		run.progress(`refactor run stopped after ${batch.id} — ${RunStatus.Escalated}`);
		settlement.result = run.buildHaltedResult({ error });
	}

	return settlement;
};
