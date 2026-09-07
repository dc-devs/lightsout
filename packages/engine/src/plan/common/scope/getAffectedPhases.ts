interface Params {
	connections: Map<string, Set<string>>;
	/** The phase basenames whose text changed. */
	edited: string[];
}

/**
 * The undirected transitive closure of the edited phases over the connection
 * graph — every phase a repair to those phases can reach.
 *
 * Transitive rather than adjacent-only: a contract phase 1 changes may be
 * re-exported by phase 2 and consumed by phase 3, and stopping at the first hop
 * would leave phase 3 unread while reporting the pass as covering the repair.
 *
 * An edited basename the graph does not know still comes back, so a phase whose
 * edges could not be read is read rather than skipped.
 */
export const getAffectedPhases = ({ connections, edited }: Params): string[] => {
	const affected = new Set<string>(edited);
	const pending = [...edited];

	while (pending.length > 0) {
		const base = pending.shift() ?? '';

		for (const neighbour of connections.get(base) ?? []) {
			if (!affected.has(neighbour)) {
				affected.add(neighbour);
				pending.push(neighbour);
			}
		}
	}

	return [...affected].sort();
};
