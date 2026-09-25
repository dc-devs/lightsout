interface Params {
	/** The root run id of each family that is going. */
	roots: string[];
}

/**
 * Several unrelated runs are going — their ids, and the ask to pick one.
 *
 * Written once and called from both the bare `--watch` path and the one-shot
 * form, because naming somebody else's concurrent work is a decision the reader
 * is asked to make, and being asked it in two slightly different sentences is
 * worse than being asked it once.
 */
export const printAmbiguousRuns = ({ roots }: Params): void => {
	// Naming the ids rather than guessing: an unrelated concurrent run narrated
	// in place of the one the reader started is worse than being asked.
	console.error(`several runs are going: ${roots.join(', ')}`);
	console.error('pick one with --run <id>');
};
