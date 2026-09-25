import { GapOutcome } from '#src/contracts/plan/grade/GapOutcome.ts';
import type { GradedGap } from '#src/contracts/plan/grade/GradedGap.ts';
import { GradeFindingStatus } from '#src/contracts/plan/memory/GradeFindingStatus.ts';
import type { GradeMemory } from '#src/contracts/plan/memory/GradeMemory.ts';
import { recordObservations } from '#src/plan/common/memory/recordObservations.ts';

interface Params {
	memory: GradeMemory;
}

/**
 * Every `pending` record, re-offered to this pass's judge batching as the
 * finding it still is: its record id, its representative identity, every
 * observation it holds, and the reason nobody settled it last time.
 *
 * It is the same record-to-gap projection `openFindingGaps` makes, for the state
 * that needs judging rather than the state that needs re-verification. A pending
 * finding is never sent to `verifyOpenFindings`: asking whether the plan now
 * answers a question nobody has ruled on yet is asking the wrong question.
 */
export const pendingFindingGaps = ({ memory }: Params): GradedGap[] =>
	memory.findings
		.filter((record) => record.status === GradeFindingStatus.Pending)
		.map((record) => ({
			area: record.area,
			gap: record.gap,
			decision: record.decision,
			options: record.options,
			phase: record.phase,
			lens: record.lens,
			observations: recordObservations({ record }),
			outcome: GapOutcome.Unjudged,
			unjudgedReason: record.unjudgedReason,
			findingId: record.id,
		}));
