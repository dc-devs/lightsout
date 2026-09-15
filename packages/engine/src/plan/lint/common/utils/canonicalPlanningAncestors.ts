import type { CanonicalPlanningPhase } from '#src/plan/common/types/CanonicalPlanningPhase.ts';

interface Params {
	phases: CanonicalPlanningPhase[];
}

/** Resolve only explicit execution ancestry; a preceding sibling does not supply files or scripts. */
export const canonicalPlanningAncestors = ({ phases }: Params): Map<string, Set<string>> => {
	const ancestors = new Map<string, Set<string>>();
	const byId = new Map<string, string>();
	for (const phase of phases) {
		if (!phase.id || byId.has(phase.id) || ancestors.has(phase.file)) throw new Error('Canonical phase identity or path is duplicated');
		const names = new Set<string>();
		for (const id of phase.prerequisiteIds) {
			const parent = byId.get(id);
			if (parent === undefined) throw new Error(`Canonical phase prerequisite is missing or out of order: ${id}`);
			names.add(parent);
			for (const ancestor of ancestors.get(parent) ?? []) names.add(ancestor);
		}
		ancestors.set(phase.file, names);
		byId.set(phase.id, phase.file);
	}
	return ancestors;
};
