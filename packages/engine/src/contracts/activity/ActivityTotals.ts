import { z } from 'zod';
import { HarnessProcessUsage } from '#src/contracts/activity/HarnessProcessUsage.ts';

/**
 * Everything the fold computes for one node of an activity tree.
 *
 * Nothing here is ever written to the record — the record stores marks, and
 * these are read from them every time. `busyMs` and `idleMs` are both carried
 * so a renderer never subtracts them itself and cannot disagree with the fold.
 * There is no share-of-parent field: a child's share divides its parent's
 * `agentMs`, which a renderer computes from two numbers already here.
 */
export const ActivityTotals = z.object({
	/** End minus start. Absent while the level is unfinished, never guessed from a child. */
	wallMs: z.number().optional(),
	/** Every descendant process's duration added up. Routinely larger than `wallMs`, because agents run at once. */
	agentMs: z.number(),
	/** Time at least one descendant process was running, counting an overlap once. */
	busyMs: z.number(),
	/** `wallMs` minus `busyMs` — the time no agent was running. Absent whenever `wallMs` is. */
	idleMs: z.number().optional(),
	/** The most descendant processes running at one instant inside this node. */
	peakProcesses: z.number(),
	processCount: z.number(),
	/** The descendant processes' usage added up, field by field; a field nobody reported stays absent. */
	usage: HarnessProcessUsage,
});

export type ActivityTotals = z.infer<typeof ActivityTotals>;
