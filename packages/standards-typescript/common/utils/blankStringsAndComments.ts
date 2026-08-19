interface Params {
	/** A source file's text. */
	text: string;
}

/** Overwrite a span with spaces, leaving newlines so every later line number still counts the same. */
const blank = ({ chars, from, to }: { chars: string[]; from: number; to: number }) => {
	for (let index = from; index < to && index < chars.length; index += 1) {
		if (chars[index] !== '\n') {
			chars[index] = ' ';
		}
	}
};

/** Blank a quoted string from its opening quote, honouring backslash escapes. Returns the index after it. */
const blankQuoted = ({ chars, text, start, quote }: { chars: string[]; text: string; start: number; quote: string }) => {
	let index = start + 1;

	while (index < text.length && text[index] !== quote && text[index] !== '\n') {
		index += text[index] === '\\' ? 2 : 1;
	}

	blank({ chars, from: start + 1, to: index });

	return Math.min(index + 1, text.length);
};

/** Blank a comment from its opening marker. Returns the index after it. */
const blankComment = ({ chars, text, start, line }: { chars: string[]; text: string; start: number; line: boolean }) => {
	const ended = line ? text.indexOf('\n', start) : text.indexOf('*/', start + 2);
	const stop = ended === -1 ? text.length : ended + (line ? 0 : 2);

	blank({ chars, from: start, to: stop });

	return stop;
};

/** Keywords a `/` may directly follow and still start a regex — after `return` a slash is never division. */
const regexPrefixKeywords = new Set(['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'void', 'new', 'delete', 'instanceof', 'yield', 'await']);

/**
 * Whether a `/` at this position starts a regex literal rather than a division:
 * the classic lexer heuristic. A slash after a value (an identifier, literal,
 * `)` or `]`) divides; a slash where a value is expected (after an operator,
 * an opening bracket, a comma, a keyword like `return`, or at the start)
 * begins a regex. `chars` rather than the original text, so a just-blanked
 * string cannot masquerade as a preceding value.
 */
const startsRegex = ({ chars, before }: { chars: string[]; before: number }) => {
	let index = before - 1;

	while (index >= 0 && (chars[index] === ' ' || chars[index] === '\n' || chars[index] === '\t')) {
		index -= 1;
	}

	if (index < 0) {
		return true;
	}

	const previous = chars[index] ?? '';

	if (/[A-Za-z0-9_$]/.test(previous)) {
		let start = index;

		while (start > 0 && /[A-Za-z0-9_$]/.test(chars[start - 1] ?? '')) {
			start -= 1;
		}

		return regexPrefixKeywords.has(chars.slice(start, index + 1).join(''));
	}

	return !(previous === ')' || previous === ']' || previous === "'" || previous === '"' || previous === '`');
};

/**
 * The end of a regex literal opened at `start`, honouring backslash escapes
 * and character classes (a `/` inside `[...]` does not close it) — or
 * undefined when no closing `/` arrives before the line ends, which means the
 * slash was not a regex after all.
 */
const findRegexEnd = ({ text, start }: { text: string; start: number }) => {
	let index = start + 1;
	let inClass = false;

	while (index < text.length && text[index] !== '\n') {
		const character = text[index];

		if (character === '\\') {
			index += 2;
		} else if (character === '[') {
			inClass = true;
			index += 1;
		} else if (character === ']') {
			inClass = false;
			index += 1;
		} else if (character === '/' && !inClass) {
			return index;
		} else {
			index += 1;
		}
	}

	return undefined;
};

/**
 * The same text with every string, template and comment emptied out, so what
 * is left is only code.
 *
 * A rule that scans text for a pattern cannot otherwise tell code from a
 * string that quotes code, and the rules about tests are read by the very
 * files most likely to quote it: a check's own tests pass sample code in as
 * data, and a rule's message names the thing it bans. Both were reported as
 * violations of themselves.
 *
 * Every character keeps its position — blanked spans become spaces and
 * newlines survive — so an offset or line number taken from the result points
 * at the same place in the original.
 *
 * An expression inside `${}` is code and stays, since a template can carry a
 * real call. Regular expression literals are emptied like strings: a pattern
 * is not code, and an apostrophe inside one (`/typo'd/`) once opened a
 * phantom string that swallowed the rest of the file (live lesson: refactor
 * run 6b0b3e0f, where merged test blocks produced blocking false positives).
 * Telling a regex from a division uses the standard lexer heuristic — see
 * `startsRegex` — with an unterminated candidate treated as division.
 */
export const blankStringsAndComments = ({ text }: Params): string => {
	const chars = text.split('');
	// Each entry is a nesting level: a template, or the code inside its `${}`.
	// `braces` counts the plain `{` blocks open at that level, so the `}` that
	// closes an interpolation is told apart from one closing an object.
	const levels: Array<{ template: boolean; braces: number }> = [{ template: false, braces: 0 }];
	let index = 0;

	while (index < text.length) {
		const level = levels[levels.length - 1];
		const character = text[index];
		const next = text[index + 1];

		if (level.template) {
			if (character === '\\') {
				blank({ chars, from: index, to: index + 2 });
				index += 2;
			} else if (character === '`') {
				levels.pop();
				index += 1;
			} else if (character === '$' && next === '{') {
				levels.push({ template: false, braces: 0 });
				index += 2;
			} else {
				blank({ chars, from: index, to: index + 1 });
				index += 1;
			}

			continue;
		}

		if (character === '/' && (next === '/' || next === '*')) {
			index = blankComment({ chars, text, start: index, line: next === '/' });
		} else if (character === '/' && startsRegex({ chars, before: index })) {
			const end = findRegexEnd({ text, start: index });

			if (end === undefined) {
				index += 1;
			} else {
				blank({ chars, from: index + 1, to: end });
				index = end + 1;
			}
		} else if (character === "'" || character === '"') {
			index = blankQuoted({ chars, text, start: index, quote: character });
		} else if (character === '`') {
			levels.push({ template: true, braces: 0 });
			index += 1;
		} else if (character === '{') {
			level.braces += 1;
			index += 1;
		} else if (character === '}' && level.braces === 0 && levels.length > 1) {
			levels.pop();
			index += 1;
		} else {
			level.braces -= character === '}' ? 1 : 0;
			index += 1;
		}
	}

	return chars.join('');
};
