import { z } from 'zod';
import { PlanningPath } from '#src/contracts/plan/workflow/common/types/PlanningPath.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

/** Explicit whole-plan scope cannot be confused with a missing selected scope. */
export const PlanningScope = z
	.object({
		kind: z.enum(PlanningVocabulary.Scope),
		claimIds: z.array(z.string().min(1)),
		phaseIds: z.array(z.string().min(1)),
		packageRoots: z.array(PlanningPath),
	})
	.strict()
	.refine(
		(scope) => scope.kind === PlanningVocabulary.Scope.WholePlan || scope.claimIds.length + scope.phaseIds.length + scope.packageRoots.length > 0,
		'Selected scope must name its reach',
	);
export type PlanningScope = z.infer<typeof PlanningScope>;
