interface Params {
	/** The file's lines, as the parsed plan reports them. */
	lines: string[];
	/** 1-based line number of the section's heading. */
	start: number;
	/** 1-based line number of the last line the section owns. */
	end: number;
	/** The rendered section's lines, heading line included. */
	sectionLines: string[];
}

/**
 * The file's lines with one section's 1-based inclusive span replaced.
 *
 * The span already holds whatever blank lines sat under the old section, so
 * exactly one is written back whenever a heading follows — which is what makes a
 * repeated sync leave the file byte-for-byte alone. A section running to the end
 * of the file keeps the file's own ending instead.
 *
 * Every engine-owned section is rewritten through this one span rule: two copies
 * of it would be two answers to where a section stops, which is the question the
 * whole in-place rewrite turns on.
 */
export const replaceSectionSpan = ({ lines, start, end, sectionLines }: Params): string[] => {
	const tail = lines.slice(end);
	const separator = tail.length > 0 || lines.at(-1) === '' ? [''] : [];

	return [...lines.slice(0, start - 1), ...sectionLines, ...separator, ...tail];
};
