import { z } from 'zod';
import { GapArea } from '#src/contracts/plan/grade/GapArea.ts';
import { GapCheckLens } from '#src/contracts/plan/grade/GapCheckLens.ts';
import { GapOutcome } from '#src/contracts/plan/grade/GapOutcome.ts';
import { GradeFindingStatus } from '#src/contracts/plan/memory/GradeFindingStatus.ts';

/**
 * One judged finding as the plan's memory keeps it: what was asked, who settled
 * it, and every state change since.
 *
 * The identity half mirrors `GradedGap`, because a record IS a gap the memory
 * carried across passes. What it adds is provenance a single pass cannot hold —
 * when the question was first raised, the judge outcome that created it, the
 * citation that closed it, and every time a later pass reopened it.
 */
export const GradeFindingRecord = z.object({
	/** `f<N>`, assigned in creation order and never reused. */
	id: z.string(),
	/** The plan file's basename, the same label `GradedGap.phase` carries. */
	phase: z.string(),
	lens: z.enum(GapCheckLens).optional(),
	area: z.enum(GapArea),
	gap: z.string(),
	decision: z.string(),
	options: z.array(z.string()).default([]),
	firstSeen: z.string(),
	lastSeen: z.string(),
	status: z.enum(GradeFindingStatus),
	/** The judge outcome that created the record, kept verbatim and never rewritten. `unjudged` is excluded: an unjudged finding opens no record. */
	disposition: z.enum([GapOutcome.NeedsAHuman, GapOutcome.AgentCanDecide, GapOutcome.AlreadyAnswered]),
	humanDecision: z.string().optional(),
	agentDecision: z.string().optional(),
	safeBecause: z.string().optional(),
	answerAt: z.string().optional(),
	/** Set only on a `resolved` record: where the plan now states the answer, and when a judge verified it. */
	resolution: z.object({ answerAt: z.string(), verifiedAt: z.string() }).optional(),
	reopened: z.array(z.object({ at: z.string(), reason: z.string(), priorStatus: z.enum(GradeFindingStatus) })).default([]),
});

export type GradeFindingRecord = z.infer<typeof GradeFindingRecord>;
