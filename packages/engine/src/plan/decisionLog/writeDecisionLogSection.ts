import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { SyncedPlanFile } from '#src/plan/decisionLog/common/types/SyncedPlanFile.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

interface Params {
	/** Absolute path of the plan file to rewrite. */
	path: string;
	/** The rendered section text, heading line included. */
	section: string;
}

/**
 * The file's lines with the Decision Log's 1-based inclusive span replaced.
 *
 * The span runs to the last line before the next `##`, so it already holds
 * whatever blank lines sat under the old section — exactly one is written back
 * whenever a heading follows, which is what makes a repeated sync leave the file
 * byte-for-byte alone. A section that runs to the end of the file keeps the
 * file's own ending instead.
 */
const replaceSpan = ({ lines, start, end, sectionLines }: { lines: string[]; start: number; end: number; sectionLines: string[] }) => {
	const tail = lines.slice(end);
	const separator = tail.length > 0 || lines.at(-1) === '' ? [''] : [];

	return [...lines.slice(0, start - 1), ...sectionLines, ...separator, ...tail];
};

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
 * The file is written only when the result differs from what was read: the sync
 * runs after every recorded decision and inside the draft flow, so it has to be
 * safe to repeat — a rewrite with identical content would move the file's
 * modification time and make every consumer look at it again for nothing.
 */
export const writeDecisionLogSection = async ({ path, section }: Params): Promise<SyncedPlanFile> => {
	const original = await readFile(path, 'utf8');
	const plan = parsePlan({ content: original, base: basename(path) });
	const sectionLines = section.split('\n');
	const range = plan.decisionLogRange;
	const rewritten = (
		range === undefined
			? insertSection({ lines: plan.lines, sectionLines })
			: replaceSpan({ lines: plan.lines, start: range.start, end: range.end, sectionLines })
	).join('\n');
	const updated = rewritten !== original;

	if (updated) {
		await writeFile(path, rewritten, 'utf8');
	}

	return { path, updated };
};
