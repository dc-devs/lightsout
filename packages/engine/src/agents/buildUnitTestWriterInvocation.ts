import unitTestWriterPrompt from '#src/agents/prompts/unitTestWriter.md';

interface Params {
	planContent: string;
	/** Public surfaces to test through — the only files a test file may target. May include unchanged files. */
	subjects: string[];
	/** Changed files that must execute under the tests (may overlap subjects when a changed file is itself public). */
	mustExecute: string[];
	/** Optional consumer test standards content, inlined verbatim. */
	standards?: string;
	/** Verification-gate output from a failed attempt, for fix re-invocations. */
	errorContext?: string;
	/** Repo-relative ledger test files the engine locked for this run — read-only for every writer that follows. */
	ledgerTests?: string[];
}

/**
 * Assemble the unit-test-writer invocation deterministically. The role prompt,
 * the plan, and the test standards are identical across every writer spawned
 * for a run, so they live in the system prompt — the harness's cache
 * breakpoint sits after it, so the fan-out's spawns share one cached prefix.
 * Only the per-writer subject/must-execute lists and any verification failure
 * vary, and those are the user prompt.
 */
export const buildUnitTestWriterInvocation = ({
	planContent,
	subjects,
	mustExecute,
	standards,
	errorContext,
	ledgerTests,
}: Params): { systemPrompt: string; prompt: string } => {
	const roleSections = [unitTestWriterPrompt, `# Plan (context for intended behavior)\n\n${planContent}`];

	if (standards) {
		roleSections.push(`# Standards\n\nThese rules are binding for the tests you write:\n\n${standards}`);
	}

	const bullets = ({ files }: { files: string[] }) => files.map((file) => `- ${file}`).join('\n');
	const sections = [
		`# Test subjects — write tests through these public surfaces\n\n${bullets({ files: subjects })}`,
		`# Changed internals that must execute under those tests\n\n${bullets({ files: mustExecute })}`,
		[
			'Rules for this assignment:',
			"- Never create a test file for any file outside the subjects list — an internal file's coverage is earned through the public surface that owns it, never through a dedicated test.",
			"- A subject listed here may be unchanged: it is listed because a changed internal is reached through it. Test the subject's observable behavior so the changed internals execute.",
			'- The engine will verify, from the coverage report, that every changed file listed above executed under the tests — a changed file that never runs fails the verification gate.',
		].join('\n'),
	];

	if (ledgerTests && ledgerTests.length > 0) {
		sections.push(
			`# Ledger tests (read-only)\n\n${bullets({ files: ledgerTests })}\n\nThese files state the plan's acceptance criteria and are locked for the run — never edit one; a case that belongs in a locked file goes in a sibling file beside the same subject whose name inserts \`coverage\` before the test suffix.`,
		);
	}

	if (errorContext) {
		sections.push(
			`# Verification failure\n\nA previous attempt wrote tests for these files, but the engine's verification gate failed. Fix your tests per your role rules — and if the failure traces to a source defect, report failed instead of adjusting a test.\n\n${errorContext}`,
		);
	}

	sections.push('Remember: your entire final message must be exactly one JSON report object — nothing else.');

	return {
		systemPrompt: roleSections.join('\n\n---\n\n'),
		prompt: sections.join('\n\n'),
	};
};
