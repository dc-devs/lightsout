import unitTestWriterPrompt from '../prompts/unitTestWriter.md';

interface Params {
	planContent: string;
	/** Source files changed earlier in the run — the test-writer's target set. */
	changedFiles: string[];
	/** Optional consumer test standards content, inlined verbatim. */
	standards?: string;
	/** Verification-gate output from a failed attempt, for fix re-invocations. */
	errorContext?: string;
}

/** Assemble the unit-test-writer invocation deterministically. */
export const buildUnitTestWriterInvocation = ({ planContent, changedFiles, standards, errorContext }: Params) => {
	const groupNote =
		changedFiles.length > 1
			? '\n\nThese files changed together. Test each module through its public surface and cover internal files through the boundary that owns them — write no dedicated test for a file that is internal to another listed file, and create no test for any file outside this list.'
			: '';
	const sections = [
		`# Changed files to cover\n\n${changedFiles.map((file) => `- ${file}`).join('\n')}${groupNote}`,
		`# Plan (context for intended behavior)\n\n${planContent}`,
	];

	if (standards) {
		sections.push(`# Standards\n\nThese rules are binding for the tests you write:\n\n${standards}`);
	}

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
