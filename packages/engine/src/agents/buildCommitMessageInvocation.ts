import commitMessagePrompt from '#src/agents/prompts/commitMessage.md';

interface Params {
	/** The ticket reference the engine prefixes to the subject — shown so the agent does not repeat it. */
	reference: string;
	/** Why the work was done: a plan's unit and title, a frozen ticket body, or a ticket title. */
	context: string;
	/** `git diff --cached --stat` output — the complete list of staged files. */
	stat: string;
	/** The staged diff, possibly cut to the engine's limit. */
	diff: string;
	/** Whether `diff` was cut. */
	truncated: boolean;
}

/**
 * Assemble the commit-message invocation deterministically.
 *
 * The diff is placed under its heading as it is, never inside a code fence: a
 * diff that touches a markdown file carries fences of its own, and one of them
 * could close the prompt's fence early. The role prompt is one fixed text, so
 * nothing about this commit reaches the system prompt.
 */
export const buildCommitMessageInvocation = ({ reference, context, stat, diff, truncated }: Params): { systemPrompt: string; prompt: string } => {
	const sections = [
		`# Ticket\n\n${reference}`,
		`# Why this work was done\n\n${context}`,
		`# Files changed\n\n${stat}`,
		`# Staged change\n\n${diff}`,
		...(truncated ? ["The staged change above was cut at the engine's limit. The file list above is complete — it names every file this commit changes."] : []),
		'Remember: your entire final message must be exactly one JSON object carrying the summary — nothing else.',
	];

	return {
		systemPrompt: commitMessagePrompt,
		prompt: sections.join('\n\n'),
	};
};
