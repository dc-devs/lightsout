import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { SyncedPlanFile } from '#src/plan/common/types/SyncedPlanFile.ts';
import { replaceSectionSpan } from '#src/plan/internal/common/rewriting/replaceSectionSpan.ts';
import { writePlanFileIfChanged } from '#src/plan/internal/common/rewriting/writePlanFileIfChanged.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

interface Params {
	/** Absolute path of the plan file to rewrite. */
	path: string;
	/** The `##` heading this section is found by, without the leading `##`. */
	heading: string;
	/** The rendered section text, heading line included. */
	section: string;
	/** The `##` heading whose section this one is placed immediately after when the file carries none. Appended at the end of the file when absent or itself not found. */
	after?: string;
}

/**
 * The file's lines with the section inserted, for a file that carries no such
 * heading: immediately after the anchor section's own span, or appended when the
 * file carries no anchor either — a section the plan needs is never dropped for
 * want of somewhere tidy to put it.
 */
const insertSection = ({ lines, anchorEnd, sectionLines }: { lines: string[]; anchorEnd?: number; sectionLines: string[] }) => {
	if (anchorEnd === undefined) {
		const trailingNewline = lines.at(-1) === '';
		const body = trailingNewline ? lines.slice(0, -1) : lines;

		return [...body, '', ...sectionLines, ...(trailingNewline ? [''] : [])];
	}

	return [...lines.slice(0, anchorEnd), ...sectionLines, '', ...lines.slice(anchorEnd)];
};

/**
 * Put one rendered section into one plan file under its `##` heading, and touch
 * nothing else.
 *
 * The section's span is read from the parsed plan rather than rescanned here: a
 * second span scanner would be a second answer to where a section starts and
 * ends, which is the question the whole in-place rewrite turns on.
 */
export const writePlanSection = async ({ path, heading, section, after }: Params): Promise<SyncedPlanFile> => {
	const original = await readFile(path, 'utf8');
	const plan = parsePlan({ content: original, base: basename(path) });
	const sectionLines = section.split('\n');
	const range = plan.sectionRanges.get(heading);
	const lines =
		range === undefined
			? insertSection({ lines: plan.lines, anchorEnd: after === undefined ? undefined : plan.sectionRanges.get(after)?.end, sectionLines })
			: replaceSectionSpan({ lines: plan.lines, start: range.start, end: range.end, sectionLines });

	return writePlanFileIfChanged({ path, original, lines });
};
