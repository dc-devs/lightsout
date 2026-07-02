import featureExecutorPrompt from '../prompts/featureExecutor.md';

interface Params {
	/** Full plan content, inlined — the agent never loads its own context. */
	planContent: string;
	/** Optional consumer standards content (style card), inlined verbatim. */
	standards?: string;
	/** Verification-gate output from a failed attempt, for fix re-invocations. */
	errorContext?: string;
}

/**
 * Assemble the feature-executor invocation deterministically. The engine —
 * not the agent, not a harness skill — owns context assembly: the same inputs
 * always produce byte-identical prompt structure, on the first spawn or the
 * fortieth.
 */
export const buildFeatureExecutorInvocation = ({ planContent, standards, errorContext }: Params) => {
	const sections = [`# Plan\n\n${planContent}`];

	if (standards) {
		sections.push(`# Standards\n\nThese rules are binding for every line you write:\n\n${standards}`);
	}

	if (errorContext) {
		sections.push(
			`# Verification failure\n\nA previous attempt implemented this plan, but the engine's verification gate failed. Diagnose from the output below, fix the root cause in source, and report as usual — your report must reflect the cumulative set of changed files.\n\n${errorContext}`,
		);
	}

	sections.push('Remember: your entire final message must be exactly one JSON report object — nothing else.');

	return {
		systemPrompt: featureExecutorPrompt,
		prompt: sections.join('\n\n'),
	};
};
