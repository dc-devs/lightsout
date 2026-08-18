const placeholderPatterns: { label: string; re: RegExp; skipInFence?: boolean }[] = [
	{ label: '???', re: /\?\?\?/ },
	{ label: 'TBD', re: /\bTBD\b/ },
	{ label: 'TODO', re: /\bTODO\b/ },
	{ label: 'unresolved {token}', re: /(?<!\$)\{[A-Za-z][A-Za-z0-9_]*\}/, skipInFence: true },
];

interface Params {
	/** One plan file's lines, in order — fence state is tracked per call. */
	lines: string[];
}

/**
 * First hit per placeholder label, at most one per file. Fence state is tracked
 * so `skipInFence` patterns go quiet inside backtick code blocks — a plan that
 * shows real code there legitimately writes destructuring and JSX braces. The
 * marker patterns scan every line; prose and inline code spans keep full
 * checking, so a brace-wrapped path segment is still caught.
 */
export const scanPlaceholders = ({ lines }: Params): { label: string; line: number }[] => {
	const matches: { label: string; line: number }[] = [];
	const reported = new Set<string>();
	let inFence = false;

	for (const [index, line] of lines.entries()) {
		if (/^\s*```/.test(line)) {
			inFence = !inFence;

			continue;
		}

		for (const { label, re, skipInFence } of placeholderPatterns) {
			if ((inFence && skipInFence) || reported.has(label)) {
				continue;
			}

			if (re.test(line)) {
				reported.add(label);
				matches.push({ label, line: index + 1 });
			}
		}
	}

	return matches;
};
