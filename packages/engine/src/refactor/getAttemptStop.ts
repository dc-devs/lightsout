import { BatchOutcome, type StandardsFinding, type WorkReport, WorkReportStatus } from '@/contracts';
import type { AgentOutcome } from '@/invoke';
import { BatchStopKind } from '@/refactor/common/constants/BatchStopKind';
import type { BatchStop } from '@/refactor/common/types/BatchStop';

interface Params {
	batchId: string;
	/** The executor invocation's outcome for this pass. */
	attempt: AgentOutcome<WorkReport>;
	/** The findings this pass was asked to resolve — what the salvage and scope paths re-check. */
	workFindings: StandardsFinding[];
	/** Batch-level rationale collector: the salvage and scope notes accumulate here. */
	rationale: string[];
	onProgress: (message: string) => void;
	/** Which of the given findings are still live in the tree. */
	remainingSiteKeys: (params: { frozen: StandardsFinding[] }) => Promise<string[]>;
	/** Run the batch's gates and return the failure output, or undefined when green. */
	gates: () => Promise<string | undefined>;
	/** Build the batch's done stop — the caller's shared post-step, which attaches the report and the changed files. */
	finish: (params: { outcome: BatchOutcome; remainingSiteKeys: string[] }) => Promise<BatchStop>;
}

/**
 * The terminal condition one executor pass settled by itself — a rate limit, a
 * hard invocation failure, a scope refusal, or a report that never completed —
 * or undefined when the pass reported complete and the gates decide next.
 *
 * Separate from the batch loop because this is what the AGENT's answer means;
 * the loop's job is what to do with it — verify, requeue, record.
 */
export const getAttemptStop = async ({
	batchId,
	attempt,
	workFindings,
	rationale,
	onProgress,
	remainingSiteKeys,
	gates,
	finish,
}: Params): Promise<BatchStop | undefined> => {
	let stop: BatchStop | undefined;

	if (!attempt.ok) {
		if (attempt.rateLimited) {
			stop = { kind: BatchStopKind.Parked };
		} else if ((await remainingSiteKeys({ frozen: workFindings })).length === 0 && !(await gates())) {
			// Salvage check (live lesson: a laptop-sleep-killed agent had finished
			// its edits but never reported): if the sites are verifiably gone
			// AND gates are green, the work is done — classify it, don't discard it.
			rationale.push(`[other] salvaged: agent invocation failed (${attempt.failure}) but the sites are resolved and gates are green`);
			onProgress(`${batchId}: invocation failed but work verified on disk — salvaged as resolved`);

			stop = await finish({ outcome: BatchOutcome.Resolved, remainingSiteKeys: [] });
		} else {
			stop = { kind: BatchStopKind.Failed, error: `${batchId}: ${attempt.failure}` };
		}
	} else if (attempt.report.status === WorkReportStatus.TerminatedScope) {
		// A scope refusal is judgment, not failure — record it as a decline
		// and let the run continue; the human reviews it with the report.
		rationale.push(...attempt.report.failures.map((entry) => `[scope] ${entry}`));

		stop = await finish({ outcome: BatchOutcome.Declined, remainingSiteKeys: await remainingSiteKeys({ frozen: workFindings }) });
	} else if (attempt.report.status !== WorkReportStatus.Complete) {
		stop = {
			kind: attempt.report.status === WorkReportStatus.Failed ? BatchStopKind.Failed : BatchStopKind.Escalated,
			error: `${batchId}: ${attempt.report.status} — ${attempt.report.failures.join('; ')}`,
		};
	}

	return stop;
};
