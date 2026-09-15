import { z } from 'zod';
import { PlanningDigest } from '#src/contracts/index.ts';

/** A fresh-entry obligation is separate from an old review's historical integrity. */
export const PlanningAssuranceObligation = z
	.object({ cycleId: z.string().min(1), workId: z.string().min(1), basis: PlanningDigest, dependencyIds: z.array(z.string().min(1)).min(1) })
	.strict();
export type PlanningAssuranceObligation = z.infer<typeof PlanningAssuranceObligation>;
