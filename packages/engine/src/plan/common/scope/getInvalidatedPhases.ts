import { getAffectedPhases } from '#src/plan/common/scope/getAffectedPhases.ts';

interface Params {
	/** The plan files whose coverage falls on their own account: their design text moved, no reader has ever read them, or a caller placed them. */
	edited: string[];
	/** The phase graph as it stands now — `getPhaseConnections`' answer. Absent when it could not be built, which invalidates every plan file. */
	connections?: Map<string, Set<string>>;
	/** Each plan file's phase-graph neighbours as a standing coverage entry recorded them, keyed by basename. */
	recorded: Map<string, string[]>;
	/** Every plan-file basename the deliverable holds now. */
	phaseFiles: string[];
}

/**
 * The current edges and every recorded neighbour as ONE symmetric map: a name
 * recorded as one file's neighbour joins the two in both directions, whichever
 * side recorded it.
 *
 * Merging them is what makes a deleted coupling still carry reach: a repair that
 * cuts an edge must not also delete the reason to re-read the phase on the far
 * side of it.
 */
const mergedConnections = ({ connections, recorded }: { connections: Map<string, Set<string>>; recorded: Map<string, string[]> }) => {
	const merged = new Map<string, Set<string>>([...connections].map(([base, neighbours]) => [base, new Set(neighbours)]));

	const link = ({ from, to }: { from: string; to: string }) => {
		const neighbours = merged.get(from) ?? new Set<string>();

		neighbours.add(to);
		merged.set(from, neighbours);
	};

	for (const [base, neighbours] of recorded) {
		for (const neighbour of neighbours) {
			link({ from: base, to: neighbour });
			link({ from: neighbour, to: base });
		}
	}

	return merged;
};

/**
 * Which plan files lose their coverage, given the files that lost it on their
 * own account — the one reach rule the grading path has, walked over the current
 * graph and every recorded neighbour together.
 *
 * The closure walk itself is `getAffectedPhases`'; this decides only which edges
 * it walks. The answer is filtered to the plan files the deliverable holds now,
 * so a phase a resplit deleted still carries reach ACROSS itself without ever
 * being named as a file to read.
 *
 * An absent graph answers every plan file rather than a narrower set, the
 * discipline `getDecisionReach` already keeps and the reason the graph is taken
 * as a parameter instead of built here: a reach the engine cannot place is a
 * full review, never a guess.
 */
export const getInvalidatedPhases = ({ edited, connections, recorded, phaseFiles }: Params): string[] => {
	if (connections === undefined) {
		return [...phaseFiles].sort();
	}

	const affected = getAffectedPhases({ connections: mergedConnections({ connections, recorded }), edited });

	return affected.filter((base) => phaseFiles.includes(base));
};
