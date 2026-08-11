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
 * real call. Regular expression literals are left alone: telling one from a
 * division needs a parser, and a pattern is not where these rules look.
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
