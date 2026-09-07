import testChangeReviewerPrompt from '#src/agents/prompts/testChangeReviewer.md';
import type { AcceptanceTestRecord } from '#src/contracts/index.ts';

interface Params {
	/** Full plan content, inlined. */
	planContent: string;
	/** Optional overview plan content (phased plans): context only. */
	overviewContent?: string;
	/** The verification checkpoint in flight. */
	checkpoint: string;
	/** The live acceptance-test mapping — what the reviewer must account for. */
	acceptanceTests: Pick<AcceptanceTestRecord, 'criterion' | 'testFile' | 'testName'>[];
	/** Source files the run has changed so far, so the reviewer can tell a stale test from a weakened one. */
	changedFiles: string[];
	/**
	 * One entry per changed test-side file: its repo-relative path, whether it was
	 * added, modified or removed, and the unified diff against its approved version.
	 */
	changes: { path: string; kind: string; diff: string }[];
}

/**
 * Assemble the test-change reviewer invocation deterministically. The role
 * prompt, the overview and the plan are the same at every checkpoint of a run,
 * so they ride the system prompt the harness caches through; only the
 * checkpoint's own evidence — the mapping, the changed source files and the
 * change bundle — is paid for again.
 */
export const buildTestChangeReviewInvocation = ({
	planContent,
	overviewContent,
	checkpoint,
	acceptanceTests,
	changedFiles,
	changes,
}: Params): { systemPrompt: string; prompt: string } => {
	const roleSections = [testChangeReviewerPrompt];

	if (overviewContent) {
		roleSections.push(
			`# Overview (high-level context)\n\nThe plan below is one phase of this larger effort. The overview is context only — the plan is authoritative for what the run may change.\n\n${overviewContent}`,
		);
	}

	roleSections.push(`# Plan\n\n${planContent}`);

	const sections = [`# Verification checkpoint\n\n\`${checkpoint}\` — judge the changes below before any gate of this checkpoint runs.`];

	sections.push(
		acceptanceTests.length > 0
			? `# Acceptance tests\n\nEvery one of these must still be locatable and must still pass. Account for each of them that a file you judge states:\n\n${acceptanceTests
					.map(({ criterion, testFile, testName }) => `- \`${testName}\` in ${testFile} — ${criterion}`)
					.join('\n')}`
			: '# Acceptance tests\n\nThis run names none. Judge the changes against the plan alone.',
	);

	if (changedFiles.length > 0) {
		sections.push(
			`# Changed source files\n\nWhat the run has changed so far, which is what a legitimate test correction catches up to:\n\n${changedFiles
				.map((file) => `- ${file}`)
				.join('\n')}`,
		);
	}

	sections.push(
		`# Changed test-side files\n\nOne entry per file whose content differs from the version this run last approved.\n\n${changes
			.map(({ path, kind, diff }) => `## ${path} (${kind})\n\n\`\`\`diff\n${diff}\n\`\`\``)
			.join('\n\n')}`,
	);
	sections.push('Remember: your entire final message must be exactly one JSON verdict object — nothing else.');

	return {
		systemPrompt: roleSections.join('\n\n---\n\n'),
		prompt: sections.join('\n\n'),
	};
};
