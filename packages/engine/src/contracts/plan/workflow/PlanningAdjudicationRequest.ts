import { z } from 'zod';
import { PlanningCitation } from '#src/contracts/plan/workflow/common/types/PlanningCitation.ts';

import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

/** An explicit dispute requires judgment; a clear defect goes directly to repair. */
export const PlanningAdjudicationRequest = z
	.object({
		findingIds: z.array(z.string().min(1)).min(1),
		reason: z.enum(PlanningVocabulary.Dispute),
		explanation: z.string().min(1),
		citations: z.array(PlanningCitation).min(1),
	})
	.strict();
export type PlanningAdjudicationRequest = z.infer<typeof PlanningAdjudicationRequest>;
