interface Params {
	/** Prompt text carrying double-brace tokens. */
	text: string;
	/** Token name to value; a token with no entry is left as written. */
	tokens: Record<string, string | number>;
}

/**
 * Substitute engine-owned values into a prompt document. A number the engine
 * enforces — the executor's file limit, the plan's created-file ceiling — must
 * read the same in the prompt as in the check, and a prompt that hard-codes it
 * is a second source of truth that agrees only by convention.
 *
 * Substitution happens when the invocation is assembled, so no agent and no
 * plan file ever sees a token — a template that still carries one has not been
 * through this function, and the plan lint's unresolved-`{token}` scan catching
 * it in a written plan is the correct outcome, not a false positive. The two
 * braces are a distinctive delimiter, not an escape: a doubled brace pair
 * matches that scan's pattern exactly as a single one does.
 */
export const applyPromptTokens = ({ text, tokens }: Params): string => {
	let applied = text;

	for (const [name, value] of Object.entries(tokens)) {
		applied = applied.split(`{{${name}}}`).join(String(value));
	}

	return applied;
};
