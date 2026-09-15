import { type PlanningLegacySettlement, type PlanningScope, PlanningVocabulary } from '#src/contracts/index.ts';

interface Params {
	bindings: PlanningLegacySettlement['phaseBindings'];
}

/** Interpret the frozen import mapping; later filenames cannot expand or invalidate historical scope. */
export const legacyPlanningScope = ({ bindings }: Params): PlanningScope => {
	const ids = bindings.map((binding) => binding.phaseId);
	return ids.length > 0 && ids.every((id): id is string => id !== null)
		? { kind: PlanningVocabulary.Scope.Selected, claimIds: [], phaseIds: ids, packageRoots: [] }
		: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] };
};
