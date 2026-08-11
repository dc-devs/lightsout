import { z } from 'zod';
import { PlanGap } from '@/contracts/plan/PlanGap';

/** The gap-check agent's contract: the decision-level gaps found in a plan. */
export const GapCheckReport = z.object({
	gaps: z.array(PlanGap).default([]),
});

export type GapCheckReport = z.infer<typeof GapCheckReport>;
