import { z } from 'zod';
import { DecisionRow } from '#src/contracts/plan/decisions/DecisionRow.ts';

/**
 * The session-authored `decisions.json`: the plan name plus the Decision-Log
 * rows gathered through Elicitation and Grill. `plan draft` zod-parses this on
 * read — a malformed record errors instead of silently producing a bad plan.
 */
export const DecisionsRecord = z.object({
	planName: z.string(),
	decisions: z.array(DecisionRow).default([]),
});

export type DecisionsRecord = z.infer<typeof DecisionsRecord>;
