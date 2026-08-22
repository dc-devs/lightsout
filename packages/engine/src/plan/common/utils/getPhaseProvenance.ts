import type { PhaseFile } from '#src/plan/common/types/PhaseFile.ts';
import type { PhaseProvenance } from '#src/plan/common/types/PhaseProvenance.ts';

interface Params {
	/** Every implementable plan file, already ordered by phase number. */
	phases: PhaseFile[];
}

/**
 * Resolve where each path in a phased plan comes from: a phase supplies a path
 * by creating it or moving to it, and removes one by deleting it or moving it
 * away. Pure — no disk access, so the caller decides what an unsupplied path
 * means.
 *
 * A single plan resolves to a one-phase walk with empty `providedBefore` and
 * `removedBefore` sets, which is exactly right: it has no predecessor.
 */
export const getPhaseProvenance = ({ phases }: Params): PhaseProvenance => {
	const providedBefore = new Map<string, Set<string>>();
	const removedBefore = new Map<string, Set<string>>();
	const createdBy = new Map<string, string>();
	const removedBy = new Map<string, string>();
	const provided = new Set<string>();
	const removed = new Set<string>();

	for (const phase of phases) {
		// Snapshot first, fold second: a phase must never read as its own predecessor.
		providedBefore.set(phase.base, new Set(provided));
		removedBefore.set(phase.base, new Set(removed));

		for (const path of [...phase.plan.createPaths, ...phase.plan.movePaths.map((move) => move.to)]) {
			provided.add(path);
			removed.delete(path);
			createdBy.set(path, phase.base);
		}

		for (const path of [...phase.plan.deletePaths, ...phase.plan.movePaths.map((move) => move.from)]) {
			removed.add(path);
			provided.delete(path);
			removedBy.set(path, phase.base);
		}
	}

	return { providedBefore, removedBefore, createdBy, removedBy };
};
