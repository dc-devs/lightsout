import { z } from 'zod';
import { CleanupEndReason } from '#src/contracts/run/CleanupEndReason.ts';
import { StandardsFinding } from '#src/contracts/standardsCheck/StandardsFinding.ts';
import { WorkReport } from '#src/contracts/work/WorkReport.ts';

/**
 * The refactor step's own account of implementation cleanup, stored on its step
 * record's `report` slot — the role-specific shape `StepRecord` declares as
 * `z.unknown()` and every reader validates at the boundary.
 *
 * `attempts` on the step record keeps its engine-wide meaning: a park, a resume
 * and a round each bump it, and only `roundsUsed` counts executor invocations.
 *
 * `endReason` is optional because the record is written BEFORE every
 * invocation, so a park or a crash leaves the round count on disk — and at that
 * moment no member of the closed set is true. An absent reason means cleanup is
 * still running; the five-member set stays closed, and its readers render
 * absence as "in progress" rather than inventing a sixth reason.
 */
export const RefactorStepReport = z.object({
	/** Executor invocations actually spent, carried across a resume. */
	roundsUsed: z.number().int().nonnegative(),
	/** Why cleanup ended. Absent while cleanup is still running or parked mid-loop; set exactly once, when the loop ends. */
	endReason: z.enum(CleanupEndReason).optional(),
	/** Qualifying blocking findings still standing when cleanup ended. */
	remaining: z.array(StandardsFinding),
	/** Findings on changed files the baseline already carried, unchanged or improved. */
	inherited: z.array(StandardsFinding),
	/** Findings whose provenance or worsening could not be established. */
	uncertain: z.array(StandardsFinding),
	/** Cleanup-agent failures: timeout, absent or unusable report, non-complete report. */
	failures: z.array(z.string()),
	/** The judgment reviewer's read before the first round. */
	initialReview: z.array(StandardsFinding),
	/** The judgment reviewer's read of the files cleanup changed. */
	finalReview: z.array(StandardsFinding),
	/** Rendered account of what cleanup left behind, or absent when it left nothing. */
	narration: z.string().optional(),
	/** The last executor report, kept as the account of the final round. */
	lastReport: WorkReport.optional(),
});

export type RefactorStepReport = z.infer<typeof RefactorStepReport>;
