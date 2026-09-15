import { z } from 'zod';
import { PlanningCitation } from '#src/contracts/plan/workflow/common/types/PlanningCitation.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

/** A fresh sufficiency judgment over unobserved reach, never proof that hidden bytes were read or unchanged. */
export const PlanningUnknownAssessment = z
	.object({
		dependencyIds: z.array(z.string().min(1)).min(1),
		claimIds: z.array(z.string().min(1)),
		outcome: z.enum(PlanningVocabulary.UnknownAssessment),
		reason: z.string().min(1),
		paths: z.array(z.string().min(1)),
		evidenceIds: z.array(z.string().min(1)),
		citations: z.array(PlanningCitation),
	})
	.strict()
	.refine(
		(assessment) => (assessment.outcome === PlanningVocabulary.UnknownAssessment.Unavailable ? assessment.paths.length > 0 : assessment.citations.length > 0),
		'Unknown reach requires a concrete unavailable path or observable supporting citations',
	);
export type PlanningUnknownAssessment = z.infer<typeof PlanningUnknownAssessment>;
