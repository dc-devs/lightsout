import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningArtifact, PlanningVocabulary } from '#src/contracts/index.ts';

interface Params {
	path: string;
	content: string;
}

/** Engine-owned data has no deliverable or phase authority. */
export const planningDataArtifact = ({ path, content }: Params): PlanningArtifact => ({
	path,
	variant: PlanningVocabulary.Artifact.Data,
	sha256: sha256({ content }),
	claimIds: [],
	prerequisiteIds: [],
	exports: [],
	boundaries: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] },
});
