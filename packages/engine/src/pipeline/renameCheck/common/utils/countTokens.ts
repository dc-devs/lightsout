interface Params {
	text: string;
}

/**
 * Every token in the text with how many times it occurs, whitespace ignored and
 * trailing commas dropped.
 *
 * A token is a maximal run of letters, digits, `_` and `$`, or any single other
 * non-whitespace character — so `===` is three `=` tokens, and a changed
 * operator changes the count. A `,` whose next token is `)`, `]` or `}` is not
 * counted: the formatter adds and removes those when it re-wraps a line.
 *
 * Language-blind on purpose: a rename-only phase changes Markdown, JSON and
 * snapshots as well as TypeScript, and every file is held to the same rule.
 */
export const countTokens = ({ text }: Params): Map<string, number> => {
	const tokens = text.match(/[\p{L}\p{N}_$]+|[^\s\p{L}\p{N}_$]/gu) ?? [];
	const counts = new Map<string, number>();

	for (const [index, token] of tokens.entries()) {
		const trailingComma = token === ',' && [')', ']', '}'].includes(tokens[index + 1] ?? '');

		if (!trailingComma) {
			counts.set(token, (counts.get(token) ?? 0) + 1);
		}
	}

	return counts;
};
