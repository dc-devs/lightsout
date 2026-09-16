import { replaceSectionSpan } from '#src/plan/common/rewriting/replaceSectionSpan.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

interface Params {
	content: string;
	base: string;
	heading: string;
	section: string;
	after?: string;
}

/** Rewrite one parsed section in memory, preserving the same spans and endings as filesystem section synchronization. */
export const rewritePlanSection = ({ content, base, heading, section, after }: Params): string => {
	const plan = parsePlan({ content, base });
	if ((plan.duplicateSections?.length ?? 0) > 0 || plan.unterminatedFence)
		throw new Error(`Ambiguous planning sections in ${base}; repair duplicate headings or the unterminated code fence before rewriting.`);
	const sectionLines = section.split('\n');
	const range = plan.sectionRanges.get(heading);
	const anchorEnd = after === undefined ? undefined : plan.sectionRanges.get(after)?.end;
	let lines: string[];
	if (range !== undefined) {
		lines = replaceSectionSpan({ lines: plan.lines, start: range.start, end: range.end, sectionLines });
	} else if (anchorEnd !== undefined) {
		lines = [...plan.lines.slice(0, anchorEnd), ...sectionLines, '', ...plan.lines.slice(anchorEnd)];
	} else {
		const trailingNewline = plan.lines.at(-1) === '';
		const body = trailingNewline ? plan.lines.slice(0, -1) : plan.lines;
		lines = [...body, '', ...sectionLines, ...(trailingNewline ? [''] : [])];
	}
	return lines.join('\n');
};
