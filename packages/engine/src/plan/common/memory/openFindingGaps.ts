import { GapOutcome, type GradedGap, GradeFindingStatus, type GradeMemory } from '#src/contracts/index.ts';
import { isBlockingGap } from '#src/plan/common/utils/isBlockingGap.ts';

interface Params {
	memory: GradeMemory;
	/** The gaps this pass already produced — a record a BLOCKING one of them carries as `findingId` is not repeated. */
	gaps: GradedGap[];
	/** Record id → why `verifyOpenFindings` refused to close it this pass; copied onto that record's surfaced gap. */
	refusals?: Map<string, string>;
}

/**
 * Every record still open after a pass, as a blocking gap on the same list the
 * readers' findings arrive on.
 *
 * This is how an unresolved finding keeps blocking when no reader re-reported
 * it: a reader's silence is not evidence the question was answered, and only the
 * re-verification judge closes a record. It needs no change to `isBlockingGap` —
 * the verdict, the count and the printer already agree through that one
 * predicate, and putting open records on the same list keeps that true without a
 * second gate.
 *
 * A record is skipped only when a gap in this pass carries its id AND that gap
 * is itself blocking. A fresh judge ruling a matched finding `agent-can-decide`
 * or `already-answered` must not be able to hide an open record for a pass —
 * that judge answered a reader's paraphrase, not the record.
 */
export const openFindingGaps = ({ memory, gaps, refusals }: Params): GradedGap[] => {
	const carried = new Set(gaps.filter((gap) => isBlockingGap({ gap })).map((gap) => gap.findingId));

	return memory.findings
		.filter((record) => record.status === GradeFindingStatus.Open && !carried.has(record.id))
		.map((record) => ({
			area: record.area,
			gap: record.gap,
			decision: record.decision,
			options: record.options,
			phase: record.phase,
			lens: record.lens,
			outcome: GapOutcome.NeedsAHuman,
			humanDecision: record.humanDecision,
			unjudgedReason: refusals?.get(record.id),
			findingId: record.id,
		}));
};
