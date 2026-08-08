import type { CallBlock } from '@/standardsCheck/common/types/CallBlock';
import { getLineNumber } from '@/standardsCheck/common/utils/getLineNumber';

// A string, a template literal or either comment form. Unterminated forms match
// nothing and are simply left as code — failing open rather than swallowing the
// rest of the file. A regex literal holding a quote (`/don't/`) reads as a
// string opening; that is the one shape this masking gets wrong, and it does
// not occur in the assertion-and-mock vocabulary these rules are written for.
const inertSpan = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;

/** A title argument: the call's first argument when it is a string literal. */
const titleSpan = /^\s*(['"`])((?:\\.|[^\\])*?)\1/;

/**
 * The same text with every string, template and comment blanked to spaces and
 * every newline kept, so bracket matching never trips over a brace inside a
 * string yet still reports true line numbers (the trick `blankImportSpans`
 * already uses for clone detection).
 */
const maskInert = (text: string) => text.replace(inertSpan, (span) => span.replace(/[^\n]/g, ' '));

/** Index of the bracket closing the one at `open` — the mask's length when the source is unbalanced. */
const closeIndexOf = ({ mask, open, closeChar }: { mask: string; open: number; closeChar: string }) => {
	const openChar = mask.charAt(open);
	let depth = 0;
	let cursor = open;

	for (; cursor < mask.length; cursor += 1) {
		const char = mask.charAt(cursor);

		depth += char === openChar ? 1 : char === closeChar ? -1 : 0;

		if (depth === 0) {
			break;
		}
	}

	return cursor;
};

/** Index just past the first `=>` sitting outside every bracket — 0 when there is none, so the caller reads the whole span. */
const arrowEnd = ({ mask }: { mask: string }) => {
	let depth = 0;
	let end = 0;

	for (let cursor = 0; cursor < mask.length && end === 0; cursor += 1) {
		const char = mask.charAt(cursor);

		depth += '([{'.includes(char) ? 1 : ')]}'.includes(char) ? -1 : 0;
		end = depth === 0 && char === '=' && mask.charAt(cursor + 1) === '>' ? cursor + 2 : 0;
	}

	return end;
};

interface Params {
	text: string;
	/** Callee names to extract, e.g. ['beforeEach', 'afterEach'] or ['describe']. A dotted name such as 'jest.mock' is matched whole. */
	callees: string[];
}

/**
 * Every call to one of `callees` in a file, with its callback body and its
 * nesting depth.
 *
 * A text-level pass, deliberately: resolving these through a parser would make
 * the whole test-shape group depend on a consumer TypeScript, and the group's
 * value is that it runs on any repo. What it cannot do is see through a helper
 * that wraps `beforeEach` or builds a describe title at runtime — both are
 * rare in test files, and both fail closed (no block, no finding). It also does
 * not follow a `.each` / `.only` chain, whose first parenthesis holds a table
 * rather than the callback.
 *
 * The body is what follows the callback's arrow: the contents of its braces
 * when it has a block body, and otherwise everything after the arrow, so an
 * expression-bodied factory (`() => ({ … })`) still reports its object. A call
 * with no arrow at all — a matcher such as `toStrictEqual(…)` — reports its
 * whole argument text.
 */
export const readCallBlocks = ({ text, callees }: Params): CallBlock[] => {
	const mask = maskInert(text);
	const found: Array<{ start: number; end: number; block: Omit<CallBlock, 'depth'> }> = [];

	for (const callee of callees) {
		const pattern = new RegExp(`(?:^|[^A-Za-z0-9_$])${callee.replace(/\./g, '\\.')}\\s*\\(`, 'g');

		for (const match of mask.matchAll(pattern)) {
			const matched = match[0];
			const start = match.index + matched.indexOf(callee);
			const open = match.index + matched.length - 1;
			const close = closeIndexOf({ mask, open, closeChar: ')' });
			const argSpan = text.slice(open + 1, close);
			const argMask = mask.slice(open + 1, close);
			const tailFrom = arrowEnd({ mask: argMask });
			const tail = argSpan.slice(tailFrom);
			const tailMask = argMask.slice(tailFrom);
			const brace = tailMask.search(/\S/);
			const opensBlock = tailMask.charAt(brace) === '{';

			found.push({
				start,
				end: close,
				block: {
					callee,
					title: argSpan.match(titleSpan)?.[2] ?? '',
					body: opensBlock ? tail.slice(brace + 1, closeIndexOf({ mask: tailMask, open: brace, closeChar: '}' })) : tail,
					startLine: getLineNumber({ text, index: start }),
					endLine: getLineNumber({ text, index: close }),
				},
			});
		}
	}

	const ordered = [...found].sort((first, second) => first.start - second.start);

	return ordered.map((entry) => ({
		...entry.block,
		depth: ordered.filter((other) => other.start < entry.start && entry.end <= other.end).length,
	}));
};
