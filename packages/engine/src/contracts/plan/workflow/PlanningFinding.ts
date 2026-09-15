import { z } from 'zod';
import { PlanningCitation } from '#src/contracts/plan/workflow/common/types/PlanningCitation.ts';
import { PlanningPath } from '#src/contracts/plan/workflow/common/types/PlanningPath.ts';
import { PlanningScope } from '#src/contracts/plan/workflow/common/types/PlanningScope.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

/** Decision ownership never reduces a substantive defect's severity. */
export const PlanningFinding = z
	.object({
		id: z.string().min(1),
		observationIds: z.array(z.string().min(1)).min(1),
		scope: PlanningScope,
		scenario: z.string().min(1),
		consequence: z.string().min(1),
		missingObligation: z.string().min(1),
		severity: z.enum(PlanningVocabulary.Severity),
		owner: z.enum(PlanningVocabulary.Owner),
		state: z.enum(PlanningVocabulary.FindingState),
		proposedResolution: z.string().optional(),
		resolutionClaimIds: z.array(z.string().min(1)),
		resolutionArtifacts: z.array(PlanningPath),
		verificationReceiptIds: z.array(z.string().min(1)),
		citations: z.array(PlanningCitation),
	})
	.strict();
export type PlanningFinding = z.infer<typeof PlanningFinding>;
