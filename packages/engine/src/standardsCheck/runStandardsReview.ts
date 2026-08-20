import { buildStandardsReviewInvocation } from '#src/agents/index.ts';
import { Permissions, type StandardsFinding, StandardsReviewReport, StandardsSeverity } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { invokeAgentWithContract } from '#src/invoke/index.ts';
import { createAgentHeartbeat } from '#src/standardsCheck/common/utils/createAgentHeartbeat.ts';
import { formatElapsed } from '#src/standardsCheck/common/utils/formatElapsed.ts';
import type { LoadedStandardsPackage } from '#src/standardsPackages/index.ts';

interface Params {
	cwd: string;
	driver: Driver;
	packages: LoadedStandardsPackage[];
	/** Active framework channels — judgment rules on inactive channels are not reviewed. */
	channels: string[];
	/** Files in scope — changed files at the gate, batch files in refactor, the path scope in the CLI. */
	files: string[];
	timeoutMs?: number;
	onProgress?: (message: string) => void;
}

/**
 * The rules an agent has to read, because no code can check them: every rule
 * declared judgment-only whose document is in play for this repo. Channel
 * gating is all-or-nothing per document, exactly as it is for the checks.
 */
const collectJudgmentRules = ({ packages, channels }: { packages: LoadedStandardsPackage[]; channels: string[] }) =>
	packages
		.flatMap((pkg) => pkg.rules)
		.filter((rule) => !rule.checked && (rule.channel === 'base' || channels.includes(rule.channel)))
		.map((rule) => ({ id: rule.id, documentPath: rule.documentPath, prose: rule.prose }));

/**
 * The agent's report as engine findings: advisory by construction, sited by the
 * engine, and only for rules a loaded package actually declares. Everything
 * dropped is counted and stated — a silent drop would read as a clean review.
 */
const toFindings = ({ reported, known }: { reported: StandardsReviewReport['findings']; known: Set<string> }) => {
	const findings: StandardsFinding[] = [];
	const unknownRules: string[] = [];
	const notes: string[] = [];
	let unsited = 0;

	for (const entry of reported) {
		const path = entry.files[0]?.path;

		if (!known.has(entry.rule)) {
			unknownRules.push(entry.rule);
			continue;
		}

		if (path === undefined) {
			unsited += 1;
			continue;
		}

		findings.push({
			rule: entry.rule,
			severity: StandardsSeverity.Advisory,
			siteKey: `${entry.rule}:${path}`,
			files: entry.files,
			detail: entry.detail,
			...(entry.guidance === undefined ? {} : { guidance: entry.guidance }),
		});
	}

	if (unknownRules.length > 0) {
		notes.push(`agent review: ${unknownRules.length} finding(s) dropped — no judgment rule is named ${[...new Set(unknownRules)].sort().join(', ')}`);
	}

	if (unsited > 0) {
		notes.push(`agent review: ${unsited} finding(s) dropped — reported with no file to point at`);
	}

	return { findings, notes };
};

/**
 * The other half of a standards check: an agent reads the judgment-only rules
 * against the files in scope and reports what it finds.
 *
 * Its findings are always advisory and join the same stream the machine checks
 * feed, so a reader gets one list rather than two — but they never gate, because
 * a judgment call is not evidence.
 *
 * Nothing here throws. A missing harness binary, a timeout, a rate limit, or a
 * final message that will not match the contract all come back as a skipped
 * review with a plain note: the machine half is real evidence and must still be
 * reported, and a repo whose harness is absent is not a repo in violation.
 *
 * Site keys are derived here rather than asked for, and a finding naming a rule
 * no loaded package declares is dropped — an id an agent invented must not be
 * able to enter the findings stream.
 *
 * @param files - repo-relative files in scope; an empty list reviews nothing
 * @param timeoutMs - ceiling for the single review invocation
 */
export const runStandardsReview = async ({
	cwd,
	driver,
	packages,
	channels,
	files,
	timeoutMs,
	onProgress,
}: Params): Promise<{ findings: StandardsFinding[]; notes: string[] }> => {
	const rules = collectJudgmentRules({ packages, channels });

	// Nothing to read, or nothing to read it against: no agent is spent saying so.
	if (rules.length === 0 || files.length === 0) {
		return { findings: [], notes: [] };
	}

	// One agent reads every rule against every file in one sitting, so this is
	// the slow half: the opening line says what it is waiting on and how long it
	// may take, the heartbeat says it is still going, and the closing line says
	// how long it took. The lines carry no prefix — each caller adds the context
	// its own output needs.
	const bound = timeoutMs === undefined ? '' : ` — bounded at ${formatElapsed({ elapsedMs: timeoutMs })}`;

	onProgress?.(`reading ${rules.length} judgment rule(s) against ${files.length} file(s)${bound}`);

	const heartbeat = createAgentHeartbeat({ onProgress: (message) => onProgress?.(message) });

	// Stopped in `finally` so a throwing invocation never leaves a ticker behind.
	const outcome = await invokeAgentWithContract({
		driver,
		cwd,
		invocation: buildStandardsReviewInvocation({ rules, files }),
		contract: StandardsReviewReport,
		permissions: Permissions.ReadOnly,
		timeoutMs,
		onEvent: heartbeat.onEvent,
	}).finally(() => heartbeat.stop());

	const elapsed = formatElapsed({ elapsedMs: heartbeat.elapsedMs() });

	if (!outcome.ok) {
		onProgress?.(`stopped after ${elapsed}`);

		return { findings: [], notes: [`agent review skipped — ${outcome.failure}`] };
	}

	const result = toFindings({ reported: outcome.report.findings, known: new Set(rules.map((rule) => rule.id)) });

	onProgress?.(`done in ${elapsed} — ${result.findings.length} finding(s)`);

	return result;
};
