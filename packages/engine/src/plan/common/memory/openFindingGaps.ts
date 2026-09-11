import { GapOutcome, type GradedGap, type GradeFindingRecord, GradeFindingStatus, type GradeMemory } from '#src/contracts/index.ts';
import { isBlockingGap } from '#src/plan/common/utils/isBlockingGap.ts';

interface Params {
	memory: GradeMemory;
	/** The gaps this pass already produced — a record a BLOCKING one of them carries as `findingId` is not repeated. */
	gaps: GradedGap[];
	/** Record id → why `verifyOpenFindings` refused to close it this pass; copied onto that record's surfaced gap. */
	refusals?: Map<string, string>;
}

/** The ruling half of a surfaced record: a human's question for an `open` one, and the unjudged stamp with its stored reason for a `pending` one. */
const blockingRuling = ({ record, refusals }: { record: GradeFindingRecord; refusals?: Map<string, string> }) =>
	record.status === GradeFindingStatus.Pending
		? { outcome: GapOutcome.Unjudged, unjudgedReason: record.unjudgedReason }
		: { outcome: GapOutcome.NeedsAHuman, humanDecision: record.humanDecision, unjudgedReason: refusals?.get(record.id) };

/**
 * Every record still blocking after a pass — `open` or `pending` — as a blocking
 * gap on the same list the readers' findings arrive on.
 *
 * This is how an unresolved finding keeps blocking when no reader re-reported
 * it: a reader's silence is not evidence the question was answered, and only the
 * re-verification judge closes an open record. It needs no change to
 * `isBlockingGap` — an open record surfaces as `needs-a-human` and a pending one
 * as `unjudged`, both of which that one predicate already blocks on.
 *
 * A record is skipped only when a gap in this pass carries its id AND that gap
 * is itself blocking. A fresh judge ruling a matched finding `agent-can-decide`
 * or `already-answered` must not be able to hide an open record for a pass —
 * that judge answered a reader's paraphrase, not the record.
 */
export const openFindingGaps = ({ memory, gaps, refusals }: Params): GradedGap[] => {
	const carried = new Set(gaps.filter((gap) => isBlockingGap({ gap })).map((gap) => gap.findingId));
	const blocking: GradeFindingStatus[] = [GradeFindingStatus.Open, GradeFindingStatus.Pending];

	return memory.findings
		.filter((record) => blocking.includes(record.status) && !carried.has(record.id))
		.map((record) => ({
			area: record.area,
			gap: record.gap,
			decision: record.decision,
			options: record.options,
			phase: record.phase,
			lens: record.lens,
			observations: record.observations,
			sharedDefect: record.sharedDefect,
			...blockingRuling({ record, refusals }),
			findingId: record.id,
		}));
};
