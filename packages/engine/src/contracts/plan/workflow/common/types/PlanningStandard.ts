import { z } from 'zod';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

/** Resolved standards bytes live once in the generation; this descriptor binds identity and channel. */
export const PlanningStandard = z
	.object({
		channel: z.enum(PlanningVocabulary.Channel),
		sourceIdentity: z.string().min(1),
		policyDigest: PlanningDigest,
		sha256: PlanningDigest,
		artifact: z.literal('planning-standards.json'),
	})
	.strict();
export type PlanningStandard = z.infer<typeof PlanningStandard>;
