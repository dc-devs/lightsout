import { z } from 'zod';

/**
 * One dated snapshot reduced to its counts — what a trend plots.
 *
 * Counts rather than the snapshot itself: a chart over a repo's whole history
 * would otherwise load every finding of every check ever run to draw a line.
 */
export const StandardsTrendPoint = z.object({
	at: z.string(),
	/** The subpath that run checked ('.' for the whole repo). */
	path: z.string(),
	total: z.number(),
	blocking: z.number(),
	advisory: z.number(),
	byRule: z.array(z.object({ rule: z.string(), count: z.number() })),
});

export type StandardsTrendPoint = z.infer<typeof StandardsTrendPoint>;
