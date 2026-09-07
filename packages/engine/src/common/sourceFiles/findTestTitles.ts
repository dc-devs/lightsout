/**
 * A test-call head: one of the runner's case functions, any run of its
 * modifiers, and optionally `.each`. `xtest` and `xit` come first in the
 * alternation so the longer spelling wins over the `test`/`it` inside it, and
 * the lookbehind keeps a head out of the middle of a longer word.
 */
const testCallHead = /(?<![\w$.])(?:xtest|xit|fit|test|it)(?:\.(?:only|skip|concurrent|failing))*(\.each)?/g;

/** The closing character of every bracketed span a call head can be followed by. */
const closers = new Map([
	['(', ')'],
	['{', '}'],
	['[', ']'],
]);

const quotes = new Set(["'", '"', '`']);

/**
 * The index closing the span that opens at `from` — a quoted string, a template
 * literal with its `${…}` holes, or a bracketed group — or undefined when the
 * file never closes it.
 *
 * An explicit stack rather than recursion, so one function answers for every
 * nesting a test call head can put in front of its title: `.each` takes a table
 * that is itself an array of objects holding strings.
 */
const endOfSpan = ({ content, from }: { content: string; from: number }) => {
	const stack: string[] = [content[from] ?? ''];
	let index = from + 1;

	while (index < content.length && stack.length > 0) {
		const open = stack[stack.length - 1] ?? '';
		const char = content[index] ?? '';

		if (char === '\\') {
			index += 2;
		} else if (open === "'" || open === '"') {
			if (char === open) {
				stack.pop();
			}

			index += 1;
		} else if (open === '`') {
			if (char === '$' && content[index + 1] === '{') {
				stack.push('{');
				index += 1;
			} else if (char === '`') {
				stack.pop();
			}

			index += 1;
		} else {
			if (char === closers.get(open)) {
				stack.pop();
			} else if (quotes.has(char) || closers.has(char)) {
				stack.push(char);
			}

			index += 1;
		}
	}

	return stack.length === 0 ? index - 1 : undefined;
};

const skipSpace = ({ content, from }: { content: string; from: number }) => {
	let index = from;

	while (index < content.length && /\s/.test(content[index] ?? '')) {
		index += 1;
	}

	return index;
};

/** The quoted literal starting at `from`, without its quotes, or undefined when there is no title the engine can read there. */
const readTitle = ({ content, from }: { content: string; from: number }) => {
	const quote = content[from] ?? '';
	const end = quotes.has(quote) ? endOfSpan({ content, from }) : undefined;

	if (end === undefined) {
		return undefined;
	}

	const raw = content.slice(from + 1, end);

	// An interpolated template is a title whose text depends on values only the
	// runner has. A title the engine cannot read is not one it may claim to have
	// found.
	return quote === '`' && raw.includes('${') ? undefined : raw;
};

interface Params {
	/** The file's text. */
	content: string;
}

/**
 * Every test title a file states, read from its test-call heads rather than
 * from its quoted strings.
 *
 * The quoted-string search this replaces could not tell a test from a comment,
 * a `describe` block or a variable holding the same words, so a plan naming any
 * of those read as a test already present. A call head is the cheap, compiler-
 * free evidence that a name really is a case; the strong evidence is the
 * runner's own per-test result.
 *
 * An `.each` head's title comes back as its template text, placeholders and all
 * — `matchesTestTitle` is what reads those placeholders as wildcards. A head
 * whose first argument is not a readable literal contributes nothing. Titles
 * come back in source order, duplicates included.
 */
export const findTestTitles = ({ content }: Params): string[] => {
	const titles: string[] = [];

	for (const match of content.matchAll(testCallHead)) {
		let index = skipSpace({ content, from: (match.index ?? 0) + match[0].length });

		if (match[1]) {
			// `.each` takes its table first — a parenthesised argument, or a
			// tagged template — and the title only follows that.
			const table = content[index] === '(' || content[index] === '`' ? endOfSpan({ content, from: index }) : undefined;

			if (table === undefined) {
				continue;
			}

			index = skipSpace({ content, from: table + 1 });
		}

		const title = content[index] === '(' ? readTitle({ content, from: skipSpace({ content, from: index + 1 }) }) : undefined;

		if (title !== undefined) {
			titles.push(title);
		}
	}

	return titles;
};
