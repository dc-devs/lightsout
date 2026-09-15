import { z } from 'zod';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';
import { PlanningPath } from '#src/contracts/plan/workflow/common/types/PlanningPath.ts';
import { PlanningScope } from '#src/contracts/plan/workflow/common/types/PlanningScope.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

/** A view's content identity and contract coverage in an immutable generation. */
export const PlanningArtifact = z
	.object({
		path: PlanningPath,
		variant: z.enum(PlanningVocabulary.Artifact),
		phaseId: z.string().min(1).optional(),
		sha256: PlanningDigest,
		claimIds: z.array(z.string().min(1)),
		prerequisiteIds: z.array(z.string().min(1)),
		exports: z.array(z.string().min(1)),
		/** Optional canonical authoring metadata; absence never rewrites older generations. */
		scopeText: z.string().min(1).optional(),
		declaredScripts: z.array(z.string().min(1)).optional(),
		boundaries: PlanningScope,
	})
	.strict();
export type PlanningArtifact = z.infer<typeof PlanningArtifact>;
