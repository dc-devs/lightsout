import featureExecutorPrompt from '../prompts/featureExecutor.md';

interface Params {
	/** Full plan content, inlined — the agent never loads its own context. */
	planContent: string;
	/** Optional overview plan content (phased plans): high-level context; the plan stays authoritative for scope. */
	overviewContent?: string;
	/** Optional consumer standards content (style card), inlined verbatim. */
	standards?: string;
	/** Verification-gate output from a failed attempt, for fix re-invocations. */
	errorContext?: string;
	/** Files already changed earlier in the run — orients fix re-invocations. */
	changedFiles?: string[];
	/** Consumer-granted command prefixes (config `agentCommands`) — the executor may run these, and only these. */
	allowedCommands?: string[];
}

/**
 * Assemble the feature-executor invocation deterministically. The engine —
 * not the agent, not a harness skill — owns context assembly: the same inputs
 * always produce byte-identical prompt structure, on the first spawn or the
 * fortieth. Everything stable across a run (overview, plan, standards, granted
 * commands) rides the system prompt the harness caches through, so a fix
 * re-invocation pays only for what actually changed: the changed-file list and
 * the gate output.
 */
export const buildFeatureExecutorInvocation = ({ planContent, overviewContent, standards, errorContext, changedFiles, allowedCommands }: Params): { systemPrompt: string; prompt: string } => {
	const roleSections = [featureExecutorPrompt];

	if (overviewContent) {
		roleSections.push(
			`# Overview (high-level context)\n\nThe plan below is one phase of this larger effort. The overview is context only — the plan is authoritative for what to build in this run.\n\n${overviewContent}`,
		);
	}

	roleSections.push(`# Plan\n\n${planContent}`);

	if (standards) {
		roleSections.push(`# Standards\n\nThese rules are binding for every line you write:\n\n${standards}`);
	}

	if (allowedCommands && allowedCommands.length > 0) {
		roleSections.push(
			`# Granted commands\n\nYou may run these shell commands — and only these (prefix match; arguments after the prefix are allowed). Use them solely to produce plan deliverables that only a command can produce (e.g. a generated migration). Never use them to verify, install, or explore — the engine runs all gates itself. List every file a granted command creates in \`changedFiles\`.\n\n${allowedCommands.map((command) => `- \`${command}\``).join('\n')}`,
		);
	}

	const sections: string[] = [];

	if (changedFiles && changedFiles.length > 0) {
		sections.push(
			`# Previously changed files\n\nFiles already created or modified earlier in this run:\n\n${changedFiles.map((file) => `- ${file}`).join('\n')}`,
		);
	}

	if (errorContext) {
		sections.push(
			`# Verification failure\n\nA previous attempt implemented this plan, but the engine's verification gate failed. Diagnose from the output below, fix the root cause in source, and report as usual — your report must reflect the cumulative set of changed files.\n\n${errorContext}`,
		);
	}

	sections.push('Remember: your entire final message must be exactly one JSON report object — nothing else.');

	return {
		systemPrompt: roleSections.join('\n\n---\n\n'),
		prompt: sections.join('\n\n'),
	};
};
