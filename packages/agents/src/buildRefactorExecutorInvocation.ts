import type { ScanFinding } from '@lightsout/contracts';
import refactorExecutorPrompt from '../prompts/refactorExecutor.md';

interface Params {
	planContent: string;
	/** Files changed earlier in the run — the only files the refactorer may modify. */
	changedFiles: string[];
	/** Optional consumer standards content (style card), inlined verbatim. */
	standards?: string;
	/** Deterministic scanner findings on the changed files — the typed work-list. */
	scanFindings?: ScanFinding[];
	/** Judgment-carrying scanner advisories (function/hook/component size) — fix unless a documented exemption applies. */
	scanAdvisories?: ScanFinding[];
	/** Verification-gate output from a failed attempt, for fix re-invocations. */
	errorContext?: string;
}

/** Assemble the refactor-executor invocation deterministically. */
export const buildRefactorExecutorInvocation = ({ planContent, changedFiles, standards, scanFindings, scanAdvisories, errorContext }: Params) => {
	const findingLine = (finding: ScanFinding) => {
		const where = finding.files
			.map((file) => `${file.path}${file.startLine ? `:${file.startLine}${file.endLine && file.endLine !== file.startLine ? `-${file.endLine}` : ''}` : ''}`)
			.join(' ↔ ');

		return `- [${finding.detector}] ${where} — ${finding.detail}`;
	};

	const sections = [
		`# Changed files to review\n\n${changedFiles.map((file) => `- ${file}`).join('\n')}`,
		`# Plan (context for what these changes were for)\n\n${planContent}`,
	];

	if (standards) {
		sections.push(`# Standards\n\nThese rules are binding:\n\n${standards}`);
	}

	if ((scanFindings && scanFindings.length > 0) || (scanAdvisories && scanAdvisories.length > 0)) {
		const parts = ['# Scan findings (deterministic detectors)'];

		if (scanFindings && scanFindings.length > 0) {
			parts.push(
				`The engine's scanner found these on the changed files. Address each one first — they are re-checked after you report — or state in your summary why one must stay:\n\n${scanFindings.map(findingLine).join('\n')}`,
			);
		}

		if (scanAdvisories && scanAdvisories.length > 0) {
			parts.push(
				`Advisory — judge each against the standards' documented exemptions (e.g. orchestration functions that only sequence step calls); fix it unless an exemption genuinely applies, and these never block the run:\n\n${scanAdvisories.map(findingLine).join('\n')}`,
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
		systemPrompt: refactorExecutorPrompt,
		prompt: sections.join('\n\n'),
	};
};
