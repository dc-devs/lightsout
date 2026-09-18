import { z } from 'zod';
import { ActivityLevelKind } from '#src/contracts/activity/ActivityLevelKind.ts';
import { ActivityMarkKind } from '#src/contracts/activity/ActivityMarkKind.ts';

/**
 * One level opening.
 *
 * No duration is stored on any mark: a duration is two timestamps subtracted,
 * and storing it as well would give the record two answers that can disagree.
 */
export const ActivityLevelStart = z.object({
	kind: z.literal(ActivityMarkKind.LevelStart),
	/** This level's identity. Marks sharing it fold into one node. */
	id: z.string(),
	/** The level this one opened inside; absent on a root. */
	parentId: z.string().optional(),
	level: z.enum(ActivityLevelKind),
	/** What this level is, in the writer's own words — the row's name in the report. */
	label: z.string(),
	/** ISO time the level opened. */
	at: z.string(),
});

export type ActivityLevelStart = z.infer<typeof ActivityLevelStart>;
