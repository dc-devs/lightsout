/** Canonical stable identity and execution edges, in validated topological order. */
export interface CanonicalPlanningPhase {
	file: string;
	id: string;
	prerequisiteIds: string[];
}
