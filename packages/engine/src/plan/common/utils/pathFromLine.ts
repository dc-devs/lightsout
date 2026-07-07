interface Params {
	line: string;
}

/** The first backtick-delimited token in a line shaped like a file path (has `/` and a `.ext`). */
export const pathFromLine = ({ line }: Params): string | undefined => {
	for (const match of line.matchAll(/`([^`]+)`/g)) {
		const token = match[1].trim().split(/\s+/)[0];

		if (token.includes('/') && /\.[A-Za-z0-9]+$/.test(token)) {
			return token;
		}
	}

	return undefined;
};
