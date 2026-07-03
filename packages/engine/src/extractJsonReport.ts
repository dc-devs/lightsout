interface Params {
	text: string;
}

/** Index of the `}` closing the object opened at `start`, or -1 if unbalanced. String-aware: braces inside JSON strings don't count. */
const findBalancedEnd = ({ text, start }: { text: string; start: number }) => {
	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let index = start; index < text.length; index += 1) {
		const char = text[index];

		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === '\\') {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}

			continue;
		}

		if (char === '"') {
			inString = true;
		} else if (char === '{') {
			depth += 1;
		} else if (char === '}') {
			depth -= 1;

			if (depth === 0) {
				return index;
			}
		}
	}

	return -1;
};

/**
 * Last parseable JSON object embedded anywhere in the text. "Last" because
 * the report is the agent's closing act — anything object-shaped earlier is
 * prose or examples.
 */
const lastEmbeddedJsonObject = ({ text }: Params): unknown => {
	let found: unknown;
	let start = text.indexOf('{');

	while (start !== -1) {
		const end = findBalancedEnd({ text, start });

		if (end === -1) {
			start = text.indexOf('{', start + 1);
			continue;
		}

		try {
			found = JSON.parse(text.slice(start, end + 1));
			start = text.indexOf('{', end + 1);
		} catch {
			start = text.indexOf('{', start + 1);
		}
	}

	return found;
};

/**
 * Pull a JSON payload out of an agent's final message. Agents are instructed
 * to emit bare JSON; tolerated deviations, in order: a fenced block, then a
 * JSON object embedded in prose (the first consumer run failed twice holding
 * a valid report behind one sentence of preamble). Strictness lives in the
 * role's zod contract — the only thing allowed to assign meaning to the
 * returned `unknown` — not in finding the payload.
 */
export const extractJsonReport = ({ text }: Params): unknown => {
	const trimmed = text.trim();

	try {
		return JSON.parse(trimmed);
	} catch {
		// fall through to the tolerant tiers
	}

	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);

	if (fenced?.[1]) {
		try {
			return JSON.parse(fenced[1].trim());
		} catch {
			// fall through
		}
	}

	return lastEmbeddedJsonObject({ text: trimmed });
};
