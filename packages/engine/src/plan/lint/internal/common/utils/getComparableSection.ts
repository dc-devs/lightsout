interface Params {
	/** One section's lines, its heading line included. */
	lines: string[];
}

/**
 * One section's lines as they compare: each line's trailing whitespace removed
 * and trailing blank lines dropped. How a section joins the heading below it is
 * the rewriter's business, so a file that differs from the rendered text only in
 * how it ends is current rather than stale. An interior blank line is content
 * the section itself states and survives.
 *
 * Spelled once because two currency checks re-render and compare a section this
 * way, and two copies drifting would let one check report a file the other calls
 * current.
 */
export const getComparableSection = ({ lines }: Params): string => {
	const trimmed = lines.map((line) => line.replace(/\s+$/, ''));

	while (trimmed.at(-1) === '') {
		trimmed.pop();
	}

	return trimmed.join('\n');
};
