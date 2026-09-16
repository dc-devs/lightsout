import { z } from 'zod';
import { PlanningArtifact } from '#src/contracts/plan/workflow/common/types/PlanningArtifact.ts';
import { PlanningDigest } from '#src/contracts/plan/workflow/common/types/PlanningDigest.ts';
import { PlanningVocabulary } from '#src/contracts/plan/workflow/PlanningVocabulary.ts';

/** Authoring proposal for a stable phase boundary; only the engine supplies resulting byte hashes. */
export const PlanningArtifactLayout = PlanningArtifact.omit({ sha256: true })
	.extend({
		variant: z.enum([PlanningVocabulary.Artifact.Single, PlanningVocabulary.Artifact.Overview, PlanningVocabulary.Artifact.Phase]),
		baseDescriptorDigest: PlanningDigest.nullable(),
	})
	.strict()
	.refine(
		(layout) => (layout.variant === PlanningVocabulary.Artifact.Phase) === (layout.phaseId !== undefined),
		'Only phase layouts have a stable phase identity',
	);
export type PlanningArtifactLayout = z.infer<typeof PlanningArtifactLayout>;
