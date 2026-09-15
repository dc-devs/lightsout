import { type PlanningScope, PlanningVocabulary } from '#src/contracts/index.ts';

interface Params {
	outer: PlanningScope;
	inner: PlanningScope;
}

/** Scope authorization requires containment in every declared dimension; an empty list never widens authority. */
export const planningScopeContains = ({ outer, inner }: Params): boolean =>
	outer.kind === PlanningVocabulary.Scope.WholePlan ||
	(inner.kind === PlanningVocabulary.Scope.Selected &&
		inner.claimIds.every((id) => outer.claimIds.includes(id)) &&
		inner.phaseIds.every((id) => outer.phaseIds.includes(id)) &&
		inner.packageRoots.every((root) => outer.packageRoots.some((allowed) => allowed === '.' || root === allowed || root.startsWith(`${allowed}/`))));
