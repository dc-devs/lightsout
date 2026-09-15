import { type PlanningArtifact, type PlanningRecord, type PlanningScope, PlanningVocabulary } from '#src/contracts/index.ts';
import { selectPlanningArtifacts } from '#src/plan/workflow/common/utils/selectPlanningArtifacts.ts';

interface Params {
	record: PlanningRecord;
	scope: PlanningScope;
}

/** Context can include prerequisite views; only explicitly assigned boundaries are writable. */
export const selectWritablePlanningArtifacts = ({ record, scope }: Params): PlanningArtifact[] =>
	selectPlanningArtifacts({ record, scope, claimIds: scope.claimIds }).filter(
		(artifact) =>
			artifact.variant !== PlanningVocabulary.Artifact.Data &&
			(scope.kind === PlanningVocabulary.Scope.WholePlan ||
				(artifact.phaseId !== undefined && scope.phaseIds.includes(artifact.phaseId)) ||
				artifact.claimIds.some((id) => scope.claimIds.includes(id)) ||
				artifact.boundaries.packageRoots.some((root) =>
					scope.packageRoots.some((allowed) => allowed === '.' || root === allowed || root.startsWith(`${allowed}/`)),
				)),
	);
