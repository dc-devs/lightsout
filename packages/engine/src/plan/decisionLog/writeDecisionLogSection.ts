import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { replaceSectionSpan } from '#src/plan/common/rewriting/replaceSectionSpan.ts';
import { writePlanFileIfChanged } from '#src/plan/common/rewriting/writePlanFileIfChanged.ts';
import type { SyncedPlanFile } from '#src/plan/common/types/SyncedPlanFile.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

interface Params {
	/** Absolute path of the plan file to rewrite. */
	path: string;
	/** The rendered section text, heading line included. */
	section: string;
}

/**
 * The file's lines with a Decision Log inserted, for a plan file that carries
 * none. `## Global Constraints` is the anchor because every plan variant
 * requires it; a file carrying neither heading is malformed, and the history is
 * appended rather than dropped.
 */
const insertSection = ({ lines, sectionLines }: { lines: string[]; sectionLines: string[] }) => {
	const anchor = lines.findIndex((line) => /^##\s+Global Constraints\s*$/.test(line));
	const trailingNewline = lines.at(-1) === '';
	const body = trailingNewline ? lines.slice(0, -1) : lines;

	return anchor === -1
		? [...body, '', ...sectionLines, ...(trailingNewline ? [''] : [])]
		: [...lines.slice(0, anchor), ...sectionLines, '', ...lines.slice(anchor)];
};

/**
 * Put one rendered `## Decision Log` section into one plan file, and touch
 * nothing else.
 *
 * The Decision Log keeps its own writer rather than going through the generic
 * one: it is inserted *before* its anchor instead of after it, and that
 * placement rule is this file's own.
 */
export const writeDecisionLogSection = async ({ path, section }: Params): Promise<SyncedPlanFile> => {
	const original = await readFile(path, 'utf8');
	const plan = parsePlan({ content: original, base: basename(path) });
	const sectionLines = section.split('\n');
	const range = plan.decisionLogRange;
	const lines =
		range === undefined
			? insertSection({ lines: plan.lines, sectionLines })
			: replaceSectionSpan({ lines: plan.lines, start: range.start, end: range.end, sectionLines });

	return writePlanFileIfChanged({ path, original, lines });
};
