import { z } from 'zod';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import { ShippingStepId } from '#src/contracts/ship/ShippingStepId.ts';

/** One ship step in the current attempt. It carries no attempts count: the record's own `attempt` does. */
const shippingStepRecord = z.object({
	id: z.enum(ShippingStepId),
	status: z.enum(RunStatus),
	/** ISO time the step last started. */
	startedAt: z.string().optional(),
	/** Set once the step finishes. */
	durationMs: z.number().optional(),
});

/**
 * What the ship sequence last recorded about its own steps, written to
 * `.lightsout/ship/progress/<branch>.json` in the checkout it ships.
 *
 * It sits beside the ship result rather than replacing it: the result is the
 * hand-off a tracker skill reads once the ship has ended, and this is what
 * `lightsout status --shipping` reads while it is still going.
 */
export const ShippingProgress = z.object({
	/** The branch as git names it. */
	branch: z.string(),
	/** The current attempt, 1-based. */
	attempt: z.number().int().positive(),
	/** The ship's own bound on attempts. */
	maxAttempts: z.number().int().positive(),
	/** The process that records. */
	pid: z.number().int(),
	/** ISO time the ship's first attempt began. */
	startedAt: z.string(),
	/** ISO time of the last write. */
	updatedAt: z.string(),
	/** ISO time the ship sequence finished. Set only once it has. */
	endedAt: z.string().optional(),
	/** The last progress line the sequence narrated. */
	lastProgress: z.string().optional(),
	steps: z.array(shippingStepRecord),
});

export type ShippingProgress = z.infer<typeof ShippingProgress>;
