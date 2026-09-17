interface Params {
	line: string;
}

/** Every backtick-delimited span in a line, trimmed, in order — the plan template's one machine-readable form, so a check reads names rather than prose. */
export const getCodeSpans = ({ line }: Params): string[] => [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());
