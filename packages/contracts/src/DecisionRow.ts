import { z } from 'zod';
import { DecisionSource } from './DecisionSource';

/**
 * One Decision-Log row the session authors during the planning dialogue: where
 * it came from, the question, the options weighed, the choice, and why. An
 * `assumption` row is a choice made without human confirmation, flagged so the
 * gap-check can surface it.
 */
export const DecisionRow = z.object({
	source: z.enum(DecisionSource),
	question: z.string(),
	options: z.string(),
	choice: z.string(),
	rationale: z.string(),
	assumption: z.boolean().default(false),
});

export type DecisionRow = z.infer<typeof DecisionRow>;
