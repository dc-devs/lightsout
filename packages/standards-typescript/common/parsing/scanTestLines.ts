interface Params {
	text: string;
	/** A single-line pattern whose first capture group is the name being declared. Must not be global — a global pattern would skip every other line. */
	pattern: RegExp;
}

/**
 * Every line of a test file matching `pattern`, as the name it declares and the
 * 1-based line it sits on.
 *
 * Two rules — the mock prefix and the shared `let` — judge declarations one line
 * at a time and differ only in the pattern and in what they then do with the
 * name, so the scan itself is written once and neither rule owns it.
 */
export const scanTestLines = ({ text, pattern }: Params): Array<{ name: string; line: number }> => {
	const declared: Array<{ name: string; line: number }> = [];

	text.split('\n').forEach((line, index) => {
		const name = line.match(pattern)?.[1] ?? '';

		if (name !== '') {
			declared.push({ name, line: index + 1 });
		}
	});

	return declared;
};
