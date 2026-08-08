import type { StandardsFinding } from '@/contracts';
import { formatFindingSite } from '@/agents/formatFindingSite';
import { formatFindingText } from '@/agents/formatFindingText';
import refactorExecutorPrompt from '@/agents/prompts/refactorExecutor.md';

interface Params {
	planContent: string;
	/** Files changed earlier in the run — the only files the refactorer may modify. */
	changedFiles: string[];
	/** Optional consumer standards content (style card), inlined verbatim. */
	standards?: string;
	/** Deterministic standards findings on the changed files — the typed work-list. */
	findings?: StandardsFinding[];
	/** Judgment-carrying standards advisories (function/hook/component size) — fix unless a documented exemption applies. */
	advisories?: StandardsFinding[];
	/** Verification-gate output from a failed attempt, for fix re-invocations. */
	errorContext?: string;
}

/** Render one standards finding as a markdown bullet with its formatted site(s). */
const findingLine = (finding: StandardsFinding) => {
	const where = finding.files.map((file) => formatFindingSite({ file })).join(' ↔ ');

	return `- [${finding.rule}] ${where} — ${formatFindingText({ finding })}`;
};

/**
 * Assemble the refactor-executor invocation deterministically. The plan and
 * standards are identical on every pass, so they ride the system prompt the
 * harness caches through; the review list, standards findings, and any gate
 * output grow between passes and stay in the user prompt.
 */
export const buildRefactorExecutorInvocation = ({ planContent, changedFiles, standards, findings, advisories, errorContext }: Params): { systemPrompt: string; prompt: string } => {
	const roleSections = [refactorExecutorPrompt, `# Plan (context for what these changes were for)\n\n${planContent}`];

	if (standards) {
		roleSections.push(`# Standards\n\nThese rules are binding:\n\n${standards}`);
	}

	const sections = [`# Changed files to review\n\n${changedFiles.map((file) => `- ${file}`).join('\n')}`];

	if ((findings && findings.length > 0) || (advisories && advisories.length > 0)) {
		const parts = ['# Standards findings (deterministic checks)'];

		if (findings && findings.length > 0) {
			parts.push(
				`Blocking — the engine's standards checks found these on the changed files. Address each one first, they are re-checked after you report, or state in your summary why one must stay:\n\n${findings.map(findingLine).join('\n')}`,
			);
		}

		if (advisories && advisories.length > 0) {
			parts.push(
				`Advisory — judge each against the standards' documented exemptions (e.g. orchestration functions that only sequence step calls); fix it unless an exemption genuinely applies, and these never block the run:\n\n${advisories.map(findingLine).join('\n')}`,
			);
		}

		sections.push(parts.join('\n\n'));
	}

	if (errorContext) {
		sections.push(
			`# Verification failure\n\nA previous refactor pass broke the engine's verification gate. Diagnose from the output below and fix the root cause within your role limits.\n\n${errorContext}`,
		);
	}

	sections.push('Remember: your entire final message must be exactly one JSON report object — nothing else.');

	return {
		systemPrompt: roleSections.join('\n\n---\n\n'),
		prompt: sections.join('\n\n'),
	};
};
