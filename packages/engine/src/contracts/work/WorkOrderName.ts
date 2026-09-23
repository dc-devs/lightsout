import { z } from 'zod';

/**
 * The summarising agent's output contract: the three or four words a work
 * order's label carries, lowercase and joined by single hyphens.
 *
 * The word count lives here rather than in the role prompt because this is what
 * the engine can enforce. A chatty answer, a sentence, or two words is rejected
 * at the boundary, the re-emit rung retries once, and a second failure falls
 * back to the mechanical slug — so an answer the engine cannot turn into a
 * label never reaches the label.
 */
export const WorkOrderName = z.object({
	/** Three or four lowercase letter-and-digit words joined by single hyphens. */
	words: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+){2,3}$/u, 'a work order name is three or four lowercase words joined by single hyphens'),
});

export type WorkOrderName = z.infer<typeof WorkOrderName>;
