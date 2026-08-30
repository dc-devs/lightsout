import { renderDocsSurfaces } from '#src/agents/common/utils/renderDocsSurfaces.ts';
import planDocsCheckPrompt from '#src/agents/prompts/planDocsCheck.md';
import type { ConfigDocs } from '#src/contracts/index.ts';

interface Params {
	/** Every implementable plan file, in order — the whole deliverable, because the claim is a whole-plan claim. */
	planFiles: { file: string; text: string }[];
	/** Overview plan text — context for a phased plan, never checked standalone. */
	overviewText?: string;
	/** The repository's declared documentation surfaces. Never empty: the caller does not spawn without them. */
	docs: ConfigDocs;
}

/**
 * Assemble the whole-plan documentation checker's invocation deterministically.
 * The stable parts — the role prompt, the declared surfaces, the overview — live
 * in the system prompt (the harness caches through it); the plan text under
 * check is the per-invocation prompt.
 */
export const buildPlanDocsCheckInvocation = ({ planFiles, overviewText, docs }: Params): { systemPrompt: string; prompt: string } => {
	const roleSections = [planDocsCheckPrompt, `# The repository's declared documentation surfaces\n\n${renderDocsSurfaces({ docs })}`];

	if (overviewText) {
		roleSections.push(`# Overview (context only — do not check standalone)\n\n${overviewText}`);
	}

	const sections = [
		`# Docs-check input`,
		...planFiles.map(({ file, text }) => `## Plan file: ${file}\n\n${text}`),
		'Remember: your entire final message must be exactly one JSON GapCheckReport object — nothing else.',
	];

	return {
		systemPrompt: roleSections.join('\n\n---\n\n'),
		prompt: sections.join('\n\n'),
	};
};
