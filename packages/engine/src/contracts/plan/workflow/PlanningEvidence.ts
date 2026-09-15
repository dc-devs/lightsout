import { z } from 'zod';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';
import { PlanningDependency } from '#src/contracts/plan/workflow/PlanningDependency.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

/** An investigated conclusion retains uncertainty and the evidence needed to assess reuse. */
export const PlanningEvidence = z
	.object({
		id: z.string().min(1),
		assignmentId: z.string().min(1),
		claimIds: z.array(z.string().min(1)),
		dependencies: z.array(PlanningDependency),
		conclusion: z.string(),
		uncertaintyIds: z.array(z.string().min(1)),
		complete: z.boolean(),
		acquisition: z.string().min(1),
		dependencyReach: z.enum(PlanningVocabulary.DependencyReach),
		sourceIds: z.array(z.string().min(1)),
		configDigest: PlanningDigest,
		standardsDigest: PlanningDigest,
	})
	.strict();
export type PlanningEvidence = z.infer<typeof PlanningEvidence>;
