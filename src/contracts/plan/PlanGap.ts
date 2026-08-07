import { z } from 'zod';
import { GapArea } from '@/contracts/plan/GapArea';

/**
 * One decision-level gap the gap-check agent found — a place the plan would
 * force the implementing agent to guess. Carries the gap, the decision a human
 * must make to close it, and the options to choose among.
 */
export const PlanGap = z.object({
	area: z.enum(GapArea),
	gap: z.string(),
	decision: z.string(),
	options: z.array(z.string()).default([]),
});

export type PlanGap = z.infer<typeof PlanGap>;
