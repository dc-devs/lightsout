import { z } from 'zod';
import { PlanningDigest, PlanningUnknownAssessment } from '#src/contracts/index.ts';

/** Accepted current-cycle assessment of every unknown dependency. */
export const PlanningAssuranceResult = z
	.object({
		workId: z.string().min(1),
		attemptId: z.string().min(1),
		basis: PlanningDigest,
		cycleId: z.string().min(1),
		assessments: z.array(PlanningUnknownAssessment).min(1),
		blockedReasons: z.array(z.string().min(1)),
	})
	.strict();

export type PlanningAssuranceResult = z.infer<typeof PlanningAssuranceResult>;
