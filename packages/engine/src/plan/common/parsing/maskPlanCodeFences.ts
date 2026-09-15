interface Params {
	lines: string[];
}

/** Hide fenced examples from structural parsing while preserving every original line position. */
export const maskPlanCodeFences = ({ lines }: Params): { lines: string[]; unterminated: boolean } => {
	let fence: { marker: string; length: number } | undefined;
	const masked: string[] = [];
	for (const line of lines) {
		const boundary = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
		if (fence) {
			if (boundary && boundary[1][0] === fence.marker && boundary[1].length >= fence.length && boundary[2].trim() === '') fence = undefined;
			masked.push('');
			continue;
		}
		if (boundary && (boundary[1][0] !== '`' || !boundary[2].includes('`'))) {
			fence = { marker: boundary[1][0], length: boundary[1].length };
			masked.push('');
		} else masked.push(line);
	}
	return { lines: masked, unterminated: fence !== undefined };
};
