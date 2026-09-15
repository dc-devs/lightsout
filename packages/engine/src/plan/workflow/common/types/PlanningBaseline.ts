import { z } from 'zod';
import { PlanningDependency, PlanningDigest, PlanningPath } from '#src/contracts/index.ts';
import { PlanningSemanticBasis } from '#src/plan/workflow/common/types/PlanningSemanticBasis.ts';

/** Post-effect semantics prevent acceptance bookkeeping from invalidating the work that produced it. */
export const PlanningBaseline = z
	.object({
		format: z.literal('planning-baseline-v1'),
		workId: z.string().min(1),
		attemptId: z.string().min(1),
		resultReceiptId: z.string().min(1),
		acceptedRevision: z.number().int().positive(),
		packetDigest: PlanningDigest,
		invocationPolicyDigest: PlanningDigest.optional(),
		semanticBasis: PlanningSemanticBasis,
		observationPaths: z.array(PlanningPath),
		dependencies: z.array(PlanningDependency),
	})
	.strict();
export type PlanningBaseline = z.infer<typeof PlanningBaseline>;
