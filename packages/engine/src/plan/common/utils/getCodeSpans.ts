import { decodeMarkdownText } from '#src/plan/common/parsing/decodeMarkdownText.ts';

interface Params {
	line: string;
	decode?: boolean;
}

/** Every backtick-delimited span in a line, trimmed, in order — the plan template's one machine-readable form, so a check reads names rather than prose. */
export const getCodeSpans = ({ line, decode = false }: Params): string[] =>
	[...line.matchAll(/`([^`]+)`/g)].map((match) => (decode ? decodeMarkdownText({ text: match[1].trim() }) : match[1].trim()));
