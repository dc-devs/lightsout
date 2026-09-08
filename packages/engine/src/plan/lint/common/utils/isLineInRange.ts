interface Params {
	/** The line's 1-based number, which is what a plan's ranges are counted in. */
	line: number;
	/** The range to test against, absent when the file has no such section. */
	range?: { start: number; end: number };
}

/**
 * Whether a 1-based line number falls inside an inclusive line range — false
 * whenever there is no range at all.
 *
 * Both scans that pass over a plan's `## Decision Log` ask this, each walking
 * `plan.lines` by 0-based index, so the one place the two numberings meet is
 * here rather than in each loop.
 */
export const isLineInRange = ({ line, range }: Params): boolean => range !== undefined && line >= range.start && line <= range.end;
