import { z } from 'zod';
import { ActivityMarkKind } from '#src/contracts/activity/ActivityMarkKind.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';

/**
 * One level closing, and how it settled.
 *
 * `RunStatus` rather than an enum of its own: the engine already spells "how
 * did this settle" once, and a level that ended on the rate-limit wall is the
 * state `RunStatus.PausedRateLimit` already names. A level that never closes
 * writes no end mark at all — it is never given a guessed one.
 */
export const ActivityLevelEnd = z.object({
	kind: z.literal(ActivityMarkKind.LevelEnd),
	/** The `ActivityLevelStart.id` this closes. */
	id: z.string(),
	/** ISO time the level closed. */
	at: z.string(),
	outcome: z.enum(RunStatus),
});

export type ActivityLevelEnd = z.infer<typeof ActivityLevelEnd>;
