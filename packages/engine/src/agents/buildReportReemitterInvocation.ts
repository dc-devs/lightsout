import reportReemitterPrompt from '#src/agents/prompts/reportReemitter.md';

interface Params {
	/** The agent's raw final message that failed contract validation. */
	rejectedText: string;
	/** The zod validation error, so the agent sees exactly what was wrong. */
	validationError: string;
}

/**
 * A cheap formatting-recovery invocation: instead of re-running a whole role
 * prompt (minutes of agent work) when only the report's shape was wrong, ask
 * the agent to re-emit the report from its own rejected message. Reuses the
 * role's system prompt (it carries the contract) — this builder supplies only
 * the user prompt.
 */
export const buildReportReemitterInvocation = ({ rejectedText, validationError }: Params): { prompt: string } => {
	const sections = [reportReemitterPrompt, `# Validation error\n\n${validationError}`, `# Your previous final message\n\n${rejectedText}`];

	return {
		prompt: sections.join('\n\n'),
	};
};
