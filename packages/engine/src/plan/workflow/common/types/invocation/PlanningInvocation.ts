import { z } from 'zod';
import { PlanningDependency, PlanningDigest, PlanningPath, PlanningVocabulary } from '#src/contracts/index.ts';

/** Immutable binding for one semantic role invocation; formatting rungs share its packet authority. */
export const PlanningInvocation = z
	.object({
		format: z.literal('planning-invocation-v1'),
		id: z.string().min(1),
		workId: z.string().min(1),
		attemptId: z.string().min(1),
		role: z.enum(PlanningVocabulary.Role),
		stage: z.enum(PlanningVocabulary.Stage),
		inputDigest: PlanningDigest,
		packetDigest: PlanningDigest,
		invocationPolicyDigest: PlanningDigest.optional(),
		executionPolicyDigest: PlanningDigest.optional(),
		assuranceBasis: PlanningDigest.optional(),
		baseGeneration: PlanningDigest,
		sequence: z.number().int().positive(),
		observationPaths: z.array(PlanningPath),
		dependencies: z.array(PlanningDependency),
	})
	.strict();
export type PlanningInvocation = z.infer<typeof PlanningInvocation>;
