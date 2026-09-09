import type { StepRecord } from '#src/contracts/index.ts';
import type { CleanupContext } from '#src/pipeline/steps/refactorStep/common/types/CleanupContext.ts';
import type { CleanupState } from '#src/pipeline/steps/refactorStep/common/types/CleanupState.ts';

interface Params {
	context: CleanupContext;
	state: CleanupState;
}

/**
 * The step record with cleanup's own account on its `report` slot.
 *
 * The step owns that slot, so this is composed fresh before every persist —
 * including the record handed to the executor pass, whose own writes and whose
 * rate-limit park therefore carry the cleanup record rather than a bare work
 * report. Writing it before every invocation is what leaves the round count on
 * disk across a park or a crash.
 */
export const buildCleanupRecord = ({ context, state }: Params): StepRecord => ({
	...state.record,
	report: {
		roundsUsed: state.roundsUsed,
		...(state.endReason === undefined ? {} : { endReason: state.endReason }),
		remaining: state.remaining,
		inherited: state.inherited,
		uncertain: state.uncertain,
		failures: state.failures,
		initialReview: context.initialReview,
		finalReview: state.finalReview,
		...(state.narration === undefined ? {} : { narration: state.narration }),
		...(state.lastReport === undefined ? {} : { lastReport: state.lastReport }),
	},
});
