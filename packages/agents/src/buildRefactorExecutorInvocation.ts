import refactorExecutorPrompt from '../prompts/refactorExecutor.md';

interface Params {
	planContent: string;
	/** Files changed earlier in the run — the only files the refactorer may modify. */
	changedFiles: string[];
	/** Optional consumer standards content (style card), inlined verbatim. */
	standards?: string;
	/** Verification-gate output from a failed attempt, for fix re-invocations. */
	errorContext?: string;
}

/** Assemble the refactor-executor invocation deterministically. */
export const buildRefactorExecutorInvocation = ({ planContent, changedFiles, standards, errorContext }: Params) => {
	const sections = [
		`# Changed files to review\n\n${changedFiles.map((file) => `- ${file}`).join('\n')}`,
		`# Plan (context for what these changes were for)\n\n${planContent}`,
	];

	if (standards) {
		sections.push(`# Standards\n\nThese rules are binding:\n\n${standards}`);
	}

	if (errorContext) {
		sections.push(
			`# Verification failure\n\nA previous refactor pass broke the engine's verification gate. Diagnose from the output below and fix the root cause within your role limits.\n\n${errorContext}`,
		);
	}

	sections.push('Remember: your entire final message must be exactly one JSON report object — nothing else.');

	return {
		systemPrompt: refactorExecutorPrompt,
		prompt: sections.join('\n\n'),
	};
};
