import unitTestWriterPrompt from '../prompts/unitTestWriter.md';

interface Params {
	planContent: string;
	/** Source files changed earlier in the run — the test-writer's target set. */
	changedFiles: string[];
	/** Verification-gate output from a failed attempt, for fix re-invocations. */
	errorContext?: string;
}

/** Assemble the unit-test-writer invocation deterministically. */
export const buildUnitTestWriterInvocation = ({ planContent, changedFiles, errorContext }: Params) => {
	const sections = [
		`# Changed files to cover\n\n${changedFiles.map((file) => `- ${file}`).join('\n')}`,
		`# Plan (context for intended behavior)\n\n${planContent}`,
	];

	if (errorContext) {
		sections.push(
			`# Verification failure\n\nA previous attempt wrote tests for these files, but the engine's verification gate failed. Fix your tests per your role rules — and if the failure traces to a source defect, report failed instead of adjusting a test.\n\n${errorContext}`,
		);
	}

	sections.push('Remember: your entire final message must be exactly one JSON report object — nothing else.');

	return {
		systemPrompt: unitTestWriterPrompt,
		prompt: sections.join('\n\n'),
	};
};
