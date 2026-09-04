import unitTestWriterPrompt from '#src/agents/prompts/unitTestWriter.md';
import type { LedgerRow } from '#src/contracts/index.ts';

interface Params {
	planContent: string;
	/** Optional overview plan content (phased plans): high-level context only. */
	overviewContent?: string;
	/** The one test file this writer owns. */
	testFile: string;
	/** Every ledger row naming that file. */
	rows: LedgerRow[];
	/** Optional consumer test standards content, inlined verbatim. */
	standards?: string;
	/** Missing-test names from a first pass, for the single re-invocation. */
	errorContext?: string;
}

/**
 * Assemble the ledger-test-writer invocation deterministically. It is the
 * unit-test-writer role with a different assignment — named tests for one file
 * instead of subjects to cover — so the role prompt, the overview, the plan and
 * the test standards ride the system prompt exactly as they do for the coverage
 * writers, and the fan-out's spawns share one cached prefix.
 */
export const buildLedgerTestWriterInvocation = ({
	planContent,
	overviewContent,
	testFile,
	rows,
	standards,
	errorContext,
}: Params): { systemPrompt: string; prompt: string } => {
	const roleSections = [unitTestWriterPrompt];

	if (overviewContent) {
		roleSections.push(
			`# Overview (high-level context)\n\nThe plan below is one phase of this larger effort. The overview is context only — the plan is authoritative for what to build in this run.\n\n${overviewContent}`,
		);
	}

	roleSections.push(`# Plan (context for intended behavior)\n\n${planContent}`);

	if (standards) {
		roleSections.push(`# Standards\n\nThese rules are binding for the tests you write:\n\n${standards}`);
	}

	const sections = [
		`# Ledger tests to write\n\nWrite these tests, and only these, in \`${testFile}\`:\n\n${rows
			.map((row) => `- criterion: ${row.criterion}\n  - test name: \`${row.testName}\`\n  - gate: ${row.gate}`)
			.join('\n')}`,
		[
			'Rules for this assignment:',
			`- Write exactly the named tests above, in exactly \`${testFile}\`, using each test name verbatim as the test's name string.`,
			'- Write them from the signatures the plan states. The source under test may not exist on disk yet — import what the plan declares it will export, at the path the plan declares.',
			'- When the file already exists, add the named cases and change nothing else in it.',
			'- Run nothing: these tests are meant to fail until the feature is built, and the engine runs every gate after you report.',
			"- A test that cannot be written from the plan's signatures is a plan defect — report `failed` naming the row rather than inventing a signature.",
		].join('\n'),
	];

	if (errorContext) {
		sections.push(
			`# Missing tests\n\nA previous attempt wrote this file, but the engine could not find every named test in it. Add the tests below under exactly these names, leaving the rest of the file alone.\n\n${errorContext}`,
		);
	}

	sections.push('Remember: your entire final message must be exactly one JSON report object — nothing else.');

	return {
		systemPrompt: roleSections.join('\n\n---\n\n'),
		prompt: sections.join('\n\n'),
	};
};
