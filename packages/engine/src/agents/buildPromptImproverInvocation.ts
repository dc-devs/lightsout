import promptImproverPrompt from '@/agents/prompts/promptImprover.md';
import type { FrictionRecord } from '@/contracts';

interface Params {
	/** Aggregated friction records across runs, with provenance. */
	friction: FrictionRecord[];
	/** Repo-relative paths of the prompt files the improver may edit. */
	promptFiles: string[];
}

/** Assemble the prompt-improver invocation deterministically. */
export const buildPromptImproverInvocation = ({ friction, promptFiles }: Params): { systemPrompt: string; prompt: string } => {
	const entries = friction
		.map((record) => `- [${record.kind ?? 'friction'}/${record.area}] (run ${record.runId.slice(0, 8)}, step ${record.step}, ${record.at}) ${record.detail}`)
		.join('\n');

	const sections = [
		`# Friction reports\n\n${entries}`,
		`# Prompt files you may edit\n\n${promptFiles.map((file) => `- ${file}`).join('\n')}`,
		'Remember: your entire final message must be exactly one JSON report object — nothing else.',
	];

	return {
		systemPrompt: promptImproverPrompt,
		prompt: sections.join('\n\n'),
	};
};
