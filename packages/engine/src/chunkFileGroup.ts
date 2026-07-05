interface Params {
	files: string[];
	max: number;
}

/**
 * Sorted slices of at most `max` files — the pathological guard for an
 * import component too large for one writer invocation. Lexicographic order
 * keeps sibling directories adjacent, so an oversized component splits
 * approximately along subtree lines.
 */
export const chunkFileGroup = ({ files, max }: Params) => {
	const sorted = [...files].sort();
	const chunks: string[][] = [];

	for (let start = 0; start < sorted.length; start += max) {
		chunks.push(sorted.slice(start, start + max));
	}

	return chunks;
};
