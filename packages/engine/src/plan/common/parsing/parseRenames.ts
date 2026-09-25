import type { RenameRule } from '#src/contracts/plan/renames/RenameRule.ts';
import { getCodeSpans } from '#src/plan/common/utils/getCodeSpans.ts';

interface Params {
	/** The lines under the `## Renames` heading, or undefined when the section is absent. */
	sectionLines: string[] | undefined;
	/** The 1-based line number the section's first line sits at in the plan file. */
	firstLine: number;
}

/**
 * Read the `## Renames` section: one `-` bullet per rename, the old text in the
 * first backticked span and the new text in the second. Renames keep their
 * document order, because that is the order they are applied in.
 *
 * It judges shape only. A bullet naming any other number of spans is recorded by
 * its line so the lint can report it rather than lose a rename the plan meant;
 * whether two renames overlap, or one renames a text to itself, is the lint's
 * business. A line that is not a bullet is prose and is ignored.
 */
export const parseRenames = ({ sectionLines, firstLine }: Params): { renames: RenameRule[]; malformedLines: number[] } => {
	const renames: RenameRule[] = [];
	const malformedLines: number[] = [];

	for (const [index, line] of (sectionLines ?? []).entries()) {
		if (!/^\s*-\s+/.test(line)) {
			continue;
		}

		const spans = getCodeSpans({ line });

		if (spans.length === 2) {
			renames.push({ from: spans[0], to: spans[1], line: firstLine + index });
		} else {
			malformedLines.push(firstLine + index);
		}
	}

	return { renames, malformedLines };
};
