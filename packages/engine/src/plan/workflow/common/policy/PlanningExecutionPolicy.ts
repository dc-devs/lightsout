import { z } from 'zod';
import { Effort, Permissions, PlanningDigest, PlanningVocabulary } from '#src/contracts/index.ts';

/** Complete stage policy makes author-template changes require fresh independent review as well. */
export const PlanningExecutionPolicy = z
	.object({
		format: z.literal('planning-execution-policy-v1'),
		stage: z.enum(PlanningVocabulary.Stage),
		execution: z
			.object({
				driver: z.string().min(1),
				model: z.string().nullable(),
				effort: z.enum(Effort).nullable(),
				permissions: z.enum(Permissions).nullable(),
				unspecified: z.literal('harness-default'),
			})
			.strict(),
		standardsPolicyDigest: PlanningDigest,
		authoringRequirements: z.string(),
		roles: z.record(z.enum(PlanningVocabulary.Role), z.object({ digest: PlanningDigest, instructionsDigest: PlanningDigest }).strict()),
	})
	.strict();
export type PlanningExecutionPolicy = z.infer<typeof PlanningExecutionPolicy>;
