import { z } from 'zod';
import { ActivityNode } from '#src/contracts/activity/ActivityNode.ts';
import { ActivityTotals } from '#src/contracts/activity/ActivityTotals.ts';

/**
 * The whole fold of one activity record — what a reader asks for and what a
 * data-shaped report prints.
 *
 * `plan` is a caller-supplied label rather than anything this module resolves,
 * so the report can say what it is a report of without the record knowing about
 * any one pipeline.
 */
export const ActivityReport = z.object({
	/** The plan folder this record belongs to, as the caller addressed it. */
	plan: z.string(),
	/** Every level whose parent was never started, each with its own tree beneath it. */
	roots: z.array(ActivityNode),
	/** Every root added together. */
	totals: ActivityTotals,
});

export type ActivityReport = z.infer<typeof ActivityReport>;
