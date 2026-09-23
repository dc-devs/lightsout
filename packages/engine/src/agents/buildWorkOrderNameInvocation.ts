import workOrderNamePrompt from '#src/agents/prompts/workOrderName.md';

interface Params {
	/** The tracker's own spelling of the ticket reference the title belongs to. */
	ticketRef: string;
	/** The ticket's title, as the tracker holds it — usually a whole sentence. */
	title: string;
}

/**
 * Assemble the work-order naming invocation deterministically.
 *
 * The message carries a reference and a title and nothing else: the agent is
 * given one string and asked for a few words, so a repository path, a plan or a
 * run's output would only be context it has to ignore.
 */
export const buildWorkOrderNameInvocation = ({ ticketRef, title }: Params): { systemPrompt: string; prompt: string } => {
	const sections = [
		`# Ticket\n\n${ticketRef}`,
		`# Title\n\n${title}`,
		'Remember: your entire final message must be exactly one JSON object carrying the words — nothing else.',
	];

	return {
		systemPrompt: workOrderNamePrompt,
		prompt: sections.join('\n\n'),
	};
};
