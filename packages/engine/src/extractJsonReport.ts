interface Params {
	text: string;
}

/**
 * Pull a JSON payload out of an agent's final message. Agents are instructed
 * to emit bare JSON, but a fenced block is tolerated — anything else is a
 * validation failure the caller retries. Returns `unknown`: the role's zod
 * contract is the only thing allowed to assign meaning.
 */
export const extractJsonReport = ({ text }: Params): unknown => {
	const trimmed = text.trim();

	try {
		return JSON.parse(trimmed);
	} catch {
		const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);

		if (!fenced?.[1]) {
			return undefined;
		}

		try {
			return JSON.parse(fenced[1].trim());
		} catch {
			return undefined;
		}
	}
};
