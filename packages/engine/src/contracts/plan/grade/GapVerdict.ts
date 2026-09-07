import { z } from 'zod';
import { GapOutcome } from '#src/contracts/plan/grade/GapOutcome.ts';

/**
 * One judge's ruling on one reader finding: who settles it, and the evidence
 * that outcome demands. Validated by `invokeAgentWithContract`, so a payload
 * missing `outcome` is retried rather than accepted.
 *
 * The three-member enum is deliberate and is NOT `z.enum(GapOutcome)`:
 * `GapOutcome.Unjudged` is the engine's stamp for a finding nobody settled, so a
 * judge can never claim it — the same rule that keeps `phase` and `lens` out of
 * the reader's contract.
 *
 * The evidence fields are optional in the shape because only one outcome demands
 * each; which one an outcome demands is enforced in `matchGapVerdicts`, and a
 * verdict that skips its evidence is stamped `unjudged` rather than believed.
 *
 * `matchesFinding` is a claim the engine validates for the same reason: naming a
 * record the plan's memory does not hold points nowhere, exactly as a citation
 * off disk does, so it leaves the finding `unjudged` rather than being believed.
 */
export const GapVerdict = z.object({
	outcome: z.enum([GapOutcome.NeedsAHuman, GapOutcome.AgentCanDecide, GapOutcome.AlreadyAnswered]),
	/** `needs-a-human`: the decision the human has to make. */
	humanDecision: z.string().optional(),
	/** `agent-can-decide`: what the implementing agent would decide. */
	agentDecision: z.string().optional(),
	/** `agent-can-decide`: why that decision is safe to make without asking. */
	safeBecause: z.string().optional(),
	/** `already-answered`: where the answer already lives — a line of the plan, a `file:symbol`, or a standards rule. */
	answerAt: z.string().optional(),
	/** The id of a memory record this finding repeats, when the judge recognises one from the records it was given. An id no record holds leaves the finding `unjudged`. */
	matchesFinding: z.string().optional(),
});

export type GapVerdict = z.infer<typeof GapVerdict>;
