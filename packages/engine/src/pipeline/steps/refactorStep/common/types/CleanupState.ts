import type { CleanupEndReason, StandardsFinding, StepRecord, WorkReport } from '#src/contracts/index.ts';

/** The cleanup loop's moving parts — everything the persisted record is composed from, plus the two keys the loop itself steers by. */
export interface CleanupState {
	/** The step record as the last persist left it. */
	record: StepRecord;
	/** Executor invocations that returned an outcome, carried across a resume. A park counts nothing. */
	roundsUsed: number;
	/** Standards-scope files whose bytes differ from the step-start fingerprint — what cleanup itself changed. */
	edited: string[];
	failures: string[];
	remaining: StandardsFinding[];
	inherited: StandardsFinding[];
	uncertain: StandardsFinding[];
	finalReview: StandardsFinding[];
	/** Absent until the loop ends, which is what a resume reads as "still running". */
	endReason?: CleanupEndReason;
	narration?: string;
	lastReport?: WorkReport;
	/** Sorted site keys of the last round that changed nothing; a second identical set is a stable disagreement. Loop-local, never persisted. */
	lastDeclined?: string;
}
