import { z } from 'zod';
import { ActivityMarkKind } from '#src/contracts/activity/ActivityMarkKind.ts';
import { HarnessProcessUsage } from '#src/contracts/activity/HarnessProcessUsage.ts';
import { ProcessEndReason } from '#src/contracts/activity/ProcessEndReason.ts';
import { Effort } from '#src/contracts/Effort.ts';

/**
 * One harness process, start to finish.
 *
 * One mark per process rather than per logical request: a request re-run after
 * a malformed answer really did cost money twice, and summing the spawns would
 * report an expensive agent where the truth is a repeatedly rejected answer.
 * `spawn` and `reemit` are what make those rows tell each other apart, and
 * `effort` is carried because two spawns of one step can differ in nothing
 * else.
 *
 * It carries no id of its own: nothing references a process, and an id nobody
 * reads is a field that goes stale. It carries no exit code and no failure text
 * either — `endReason` already answers how the process ended.
 */
export const HarnessProcessMark = z.object({
	kind: z.literal(ActivityMarkKind.HarnessProcess),
	/** The level this process ran inside. */
	levelId: z.string(),
	/** The adapter that spawned it — a driver's own name. */
	harness: z.string(),
	/** The model override in force, when there was one. */
	model: z.string().optional(),
	/** The reasoning effort in force, when one was set; absent means the harness's own default. */
	effort: z.enum(Effort).optional(),
	/** Which spawn of its request this was, counting from one and never restarting. */
	spawn: z.number().int().positive(),
	/** True when this spawn was the cheap re-emit rather than a fresh role attempt. */
	reemit: z.boolean(),
	startedAt: z.string(),
	endedAt: z.string(),
	endReason: z.enum(ProcessEndReason),
	/** Absent when the process reported nothing at all. */
	usage: HarnessProcessUsage.optional(),
});

export type HarnessProcessMark = z.infer<typeof HarnessProcessMark>;
