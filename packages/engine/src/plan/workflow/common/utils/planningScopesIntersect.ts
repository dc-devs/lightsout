import { type PlanningScope, PlanningVocabulary } from '#src/contracts/index.ts';

interface Params {
	left: PlanningScope;
	right: PlanningScope;
}

/** Scope containment uses complete path segments; global obligations always accompany focused work. */
export const planningScopesIntersect = ({ left, right }: Params): boolean => {
	return (
		left.kind === PlanningVocabulary.Scope.WholePlan ||
		right.kind === PlanningVocabulary.Scope.WholePlan ||
		left.claimIds.some((id) => right.claimIds.includes(id)) ||
		left.phaseIds.some((id) => right.phaseIds.includes(id)) ||
		left.packageRoots.some((a) => right.packageRoots.some((b) => a === '.' || b === '.' || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)))
	);
};
