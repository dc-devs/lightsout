import { z } from 'zod';
import { ActivityLevelKind } from '#src/contracts/activity/ActivityLevelKind.ts';
import { ActivityTotals } from '#src/contracts/activity/ActivityTotals.ts';
import { HarnessProcessMark } from '#src/contracts/activity/HarnessProcessMark.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';

/**
 * One level of a folded activity tree.
 *
 * There is no `finished` flag: an absent `endedAt` is what unfinished means,
 * and a second spelling of it could contradict the first.
 */
export const ActivityNode = z.object({
	id: z.string(),
	level: z.enum(ActivityLevelKind),
	label: z.string(),
	/** The earliest start mark carrying this id. */
	startedAt: z.string(),
	/** The latest end mark carrying this id; absent while unfinished. */
	endedAt: z.string().optional(),
	/** The latest end mark's outcome; absent while unfinished. */
	outcome: z.enum(RunStatus).optional(),
	/** The processes recorded directly on this level, in the order they were written. */
	processes: z.array(HarnessProcessMark),
	totals: ActivityTotals,
	// A getter, which is how zod declares a schema that refers to itself: the
	// array is built when the property is first read, by which time the const
	// above is bound.
	get children() {
		return z.array(ActivityNode);
	},
});

export type ActivityNode = z.infer<typeof ActivityNode>;
