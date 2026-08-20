import supervisorPrompt from '#src/agents/prompts/supervisor.md';

interface Params {
	planContent: string;
	stepId: string;
	/** The verification-gate output that keeps failing. */
	errorOutput: string;
	attempts: number;
}

/** Assemble the supervisor invocation deterministically. Read-only judgment on the exception path. */
export const buildSupervisorInvocation = ({ planContent, stepId, errorOutput, attempts }: Params): { systemPrompt: string; prompt: string } => {
	const sections = [
		`# Failing step\n\n\`${stepId}\` — ${attempts} attempt(s) so far, mechanical retries exhausted.`,
		`# Verification output\n\n${errorOutput}`,
		`# Plan\n\n${planContent}`,
		'Remember: your entire final message must be exactly one JSON verdict object — nothing else.',
	];

	return {
		systemPrompt: supervisorPrompt,
		prompt: sections.join('\n\n'),
	};
};
