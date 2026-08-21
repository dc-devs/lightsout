import refactorExecutorPrompt from '#src/agents/prompts/refactorExecutor.md';
import refactorScopeFeaturePrompt from '#src/agents/prompts/refactorScopeFeature.md';
import refactorScopeStandalonePrompt from '#src/agents/prompts/refactorScopeStandalone.md';
import { RefactorScope } from '#src/common/constants/RefactorScope.ts';
import { formatFindingSite } from '#src/common/findings/formatFindingSite.ts';
import { formatFindingText } from '#src/common/findings/formatFindingText.ts';
import type { StandardsFinding } from '#src/contracts/index.ts';

interface Params {
	/**
	 * Who is invoking, which decides which files the executor may write. Required
	 * rather than defaulted: the two callers want opposite answers, and a default
	 * would silently give one of them the other's.
	 */
	scope: RefactorScope;
	planContent: string;
	/**
	 * The files to work on. In feature scope these are the only files the
	 * executor may modify; in standalone scope they are where the findings are,
	 * and the fix may reach the files it cannot be finished without.
	 */
	changedFiles: string[];
	/** Optional consumer standards content (style card), inlined verbatim. */
	standards?: string;
	/** Deterministic standards findings on the changed files — the typed work-list. */
	findings?: StandardsFinding[];
	/** Judgment-carrying standards advisories (function/hook/component size) — fix unless a documented exemption applies. */
	advisories?: StandardsFinding[];
	/** Ask for an `advisoryOutcomes` entry per advisory shown. Only callers that PERSIST the answer switch this on — asking for a field nothing records is prompt noise. */
	reportAdvisoryOutcomes?: boolean;
	/** Verification-gate output from a failed attempt, for fix re-invocations. */
	errorContext?: string;
}

/**
 * Advice is the only standards finding whose fate nothing on disk records — a
 * blocking site is re-checked, an advisory is simply gone or simply not. So the
 * agent's own answer is the record, and this is where it is asked for.
 */
const advisoryOutcomesSection = [
	'# Report what you did about each advisory',
	"For every advisory listed above — machine-checked or agent-reviewed — add one entry to the `advisoryOutcomes` array of your report: the finding's `rule` and `siteKey` copied exactly as given, an `outcome`, and for a decline a short `reason`.",
	'The three outcomes: "applied" when you made the change; "declined" when you judged the advice wrong here; "already-met" when the end-state it asks for was already true and you edited nothing. Do not report "applied" for a change you did not have to make, and do not report "declined" for advice you did not actually reject — each reads as the opposite of what happened.',
	'This is an account, never a gate: it is what tells a human which rules keep being declined and why. Reporting a decline honestly is always better than an entry that claims work you did not do.',
	'```\n"advisoryOutcomes": [{ "rule": "size-function", "siteKey": "size-function:src/example.ts", "outcome": "declined", "reason": "orchestration exemption applies — every step delegates" }]\n```',
].join('\n\n');

/** The scope section for one caller — the only part of the role prompt that differs between them. */
const scopePrompt = ({ scope }: { scope: RefactorScope }) => (scope === RefactorScope.Standalone ? refactorScopeStandalonePrompt : refactorScopeFeaturePrompt);

/**
 * What the work-list is called in the task message. "Changed files" is a true
 * description of a feature's refactor step and a false one of a standalone run,
 * where nothing has changed yet and the files are simply where the findings sit.
 */
const worklistHeading = ({ scope }: { scope: RefactorScope }) =>
	scope === RefactorScope.Standalone ? '# Files the findings name' : '# Changed files to review';

/** Render one standards finding as a markdown bullet with its formatted site(s). */
const findingLine = (finding: StandardsFinding) => {
	const where = finding.files.map((file) => formatFindingSite({ file })).join(' ↔ ');

	return `- [${finding.rule}] ${where} — ${formatFindingText({ finding })}`;
};

/**
 * An advisory line additionally carries its siteKey verbatim: the report asks
 * for that key "copied exactly as given", so the prompt has to actually give
 * it — an agent left to reconstruct the key builds one the engine may not match.
 */
const advisoryLine = (finding: StandardsFinding) => `${findingLine(finding)} (siteKey: \`${finding.siteKey}\`)`;

/**
 * Assemble the refactor-executor invocation deterministically. The plan and
 * standards are identical on every pass, so they ride the system prompt the
 * harness caches through; the review list, standards findings, and any gate
 * output grow between passes and stay in the user prompt.
 */
export const buildRefactorExecutorInvocation = ({
	scope,
	planContent,
	changedFiles,
	standards,
	findings,
	advisories,
	reportAdvisoryOutcomes,
	errorContext,
}: Params): { systemPrompt: string; prompt: string } => {
	const roleSections = [refactorExecutorPrompt, scopePrompt({ scope }), `# Plan (context for what these changes were for)\n\n${planContent}`];

	if (standards) {
		roleSections.push(`# Standards\n\nThese rules are binding:\n\n${standards}`);
	}

	const sections = [`${worklistHeading({ scope })}\n\n${changedFiles.map((file) => `- ${file}`).join('\n')}`];

	if ((findings && findings.length > 0) || (advisories && advisories.length > 0)) {
		const parts = ['# Standards findings (deterministic checks)'];

		if (findings && findings.length > 0) {
			parts.push(
				`Blocking — the engine's standards checks found these on the changed files. Address each one first, they are re-checked after you report, or state in your summary why one must stay:\n\n${findings.map(findingLine).join('\n')}`,
			);
		}

		if (advisories && advisories.length > 0) {
			parts.push(
				`Advisory — judge each against the standards' documented exemptions (e.g. orchestration functions that only sequence step calls); fix it unless an exemption genuinely applies, and these never block the run:\n\n${advisories.map(advisoryLine).join('\n')}`,
			);
		}

		sections.push(parts.join('\n\n'));
	}

	if (reportAdvisoryOutcomes && advisories && advisories.length > 0) {
		sections.push(advisoryOutcomesSection);
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
