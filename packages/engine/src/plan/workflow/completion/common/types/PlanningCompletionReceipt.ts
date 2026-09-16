import { z } from 'zod';
import { PlanningDigest, PlanningVocabulary } from '#src/contracts/index.ts';

/** Engine completion binds semantic authority and the actual assurance cycle; it never substitutes for independent review proofs. */
export const PlanningCompletionReceipt = z
	.object({
		format: z.literal('planning-completion-v1'),
		stage: z.enum(PlanningVocabulary.Stage),
		basis: PlanningDigest,
		executionPolicyDigest: PlanningDigest.optional(),
		assurance: z
			.object({
				cycleId: z.string().min(1),
				basis: PlanningDigest,
				semanticDigest: PlanningDigest,
				unknownDependencyIds: z.array(z.string().min(1)),
				pendingWorkIds: z.array(z.string().min(1)),
				blockedReasons: z.array(z.string().min(1)),
			})
			.strict()
			.optional(),
	})
	.strict();
export type PlanningCompletionReceipt = z.infer<typeof PlanningCompletionReceipt>;
