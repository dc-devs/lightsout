import type { PlanningGraphIssue } from '#src/plan/workflow/store/common/types/PlanningGraphIssue.ts';

interface Params {
	edges: Map<string, string[]>;
	at: string;
	issues: PlanningGraphIssue[];
}

/** Execution and supersession edges must be acyclic; callers deliberately omit semantic dependency edges. */
export const checkPlanningCycles = ({ edges, at, issues }: Params): void => {
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = ({ id }: { id: string }) => {
		if (visiting.has(id)) {
			issues.push({ at, message: `Execution prerequisite cycle at ${id}` });
			return;
		}
		if (visited.has(id)) return;
		visiting.add(id);
		for (const dependency of edges.get(id) ?? []) visit({ id: dependency });
		visiting.delete(id);
		visited.add(id);
	};
	for (const id of edges.keys()) visit({ id });
};
