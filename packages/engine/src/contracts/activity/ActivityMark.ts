import { z } from 'zod';
import { ActivityLevelEnd } from '#src/contracts/activity/ActivityLevelEnd.ts';
import { ActivityLevelStart } from '#src/contracts/activity/ActivityLevelStart.ts';
import { HarnessProcessMark } from '#src/contracts/activity/HarnessProcessMark.ts';

/**
 * One line of an activity record.
 *
 * The reader validates every line against this, so a line matching no member is
 * dropped rather than guessed at — which is what lets a record whose last line
 * was cut off mid-write still be read to its last complete mark.
 */
export const ActivityMark = z.discriminatedUnion('kind', [ActivityLevelStart, ActivityLevelEnd, HarnessProcessMark]);

export type ActivityMark = z.infer<typeof ActivityMark>;
