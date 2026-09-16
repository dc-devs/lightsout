import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningInput, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';

interface Params {
	input: PlanningInput;
}

/** Missing coverage becomes explicit pending work, never an inherited passing review. */
export const initialPlanningWork = ({ input }: Params): PlanningWork[] => {
	const roles = [
		PlanningVocabulary.Role.Investigate,
		PlanningVocabulary.Role.Architect,
		PlanningVocabulary.Role.DesignReview,
		...(input.stage === PlanningVocabulary.Stage.Implementation
			? [PlanningVocabulary.Role.Draft, PlanningVocabulary.Role.ImplementationReview, PlanningVocabulary.Role.IntegrationReview]
			: []),
	];
	const inputDigest = sha256({ content: canonicalJson({ value: input }) });
	return roles.map((role, index) => ({
		id: `initial:${role}`,
		role,
		stage: input.stage,
		scope: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] },
		prerequisiteIds: index === 0 ? [] : [`initial:${roles[index - 1]}`],
		inputDigest,
		status: PlanningVocabulary.WorkState.Pending,
		attemptSequence: 0,
		failureIds: [],
		diagnosisIds: [],
		assignment: `Establish ${role} obligations from the preserved sources; absence of previous coverage is not approval. Review roles must pressure-test complete original wording and rejected alternatives, concurrency, failures, ordering, compatibility, standards, interfaces and exact acceptance cases. Report coverage.claimIds, phaseIds, sourceDigests and artifactPaths only for material actually inspected. Discover omissions beyond the proposed inventory. Clear substantiated defects go directly to repair; request adjudication only for a concrete dispute.`,
	}));
};
