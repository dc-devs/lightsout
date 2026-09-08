import { isLineInRange } from '#src/plan/lint/common/utils/isLineInRange.ts';

const placeholderPatterns: { label: string; re: RegExp; skipInFence?: boolean }[] = [
	{ label: '???', re: /\?\?\?/ },
	{ label: 'TBD', re: /\bTBD\b/ },
	{ label: 'TODO', re: /\bTODO\b/ },
	{ label: 'unresolved {token}', re: /(?<!\$)\{[A-Za-z][A-Za-z0-9_]*\}/, skipInFence: true },
];

interface Params {
	/** One plan file's lines, in order — fence state is tracked per call. */
	lines: string[];
	/** A 1-based inclusive line range to pass over, if any — the Decision Log's, whose recorded words are history rather than an unresolved question. */
	skipRange?: { start: number; end: number };
}

/**
 * First hit per placeholder label, at most one per file. Fence state is tracked
 * so `skipInFence` patterns go quiet inside backtick code blocks — a plan that
 * shows real code there legitimately writes destructuring and JSX braces. The
 * marker patterns scan every line; prose and inline code spans keep full
 * checking, so a brace-wrapped path segment is still caught.
 *
 * `skipRange` is passed over INSIDE the scan rather than filtered out of its
 * result, because only the first hit per label is reported: a marker word inside
 * the skipped range would otherwise consume that label and hide a real one
 * further down the file. Fence state is still tracked across the skipped lines,
 * so a block that opens before the range and closes after it is not misread.
 */
export const scanPlaceholders = ({ lines, skipRange }: Params): { label: string; line: number }[] => {
	const matches: { label: string; line: number }[] = [];
	const reported = new Set<string>();
	let inFence = false;

	for (const [index, line] of lines.entries()) {
		if (/^\s*```/.test(line)) {
			inFence = !inFence;

			continue;
		}

		if (isLineInRange({ line: index + 1, range: skipRange })) {
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
