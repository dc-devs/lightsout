import { z } from 'zod';
import { PlanFixStatus } from '#src/contracts/plan/PlanFixStatus.ts';

/**
 * The plan-repairer agent's report from one draft-repair invocation: which
 * plan files it edited in place, or — status 'error' — why the flagged
 * findings could not be resolved from its inputs.
 */
export const PlanFixReport = z.object({
	status: z.enum(PlanFixStatus),
	filesEdited: z.array(z.string()).default([]),
	discrepancies: z.array(z.string()).default([]),
});

export type PlanFixReport = z.infer<typeof PlanFixReport>;
