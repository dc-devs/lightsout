import { formatDuration } from '@lightsout/shared';
import { buildStandardsReviewInvocation } from '#src/agents/index.ts';
import { Permissions, type StandardsFinding, StandardsReviewReport, StandardsSeverity } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { invokeAgentWithContract } from '#src/invoke/index.ts';
import { createAgentHeartbeat } from '#src/standardsCheck/common/utils/createAgentHeartbeat.ts';
import type { LoadedStandardsPack } from '#src/standardsPacks/index.ts';

interface Params {
	cwd: string;
	driver: Driver;
	packs: LoadedStandardsPack[];
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
const collectJudgmentRules = ({ packs, channels }: { packs: LoadedStandardsPack[]; channels: string[] }) =>
	packs
		.flatMap((pack) => pack.rules)
		.filter((rule) => !rule.checked && (rule.channel === 'base' || channels.includes(rule.channel)))
		.map((rule) => ({ id: rule.id, documentPath: rule.documentPath, prose: rule.prose }));

/**
 * The agent's report as engine findings: advisory by construction, sited by the
 * engine, and only for rules a loaded pack actually declares. Everything
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
 * no loaded pack declares is dropped — an id an agent invented must not be
 * able to enter the findings stream.
 *
 * @param files - repo-relative files in scope; an empty list reviews nothing
 * @param timeoutMs - ceiling for the single review invocation
 */
export const runStandardsReview = async ({
	cwd,
	driver,
	packs,
	channels,
	files,
	timeoutMs,
	onProgress,
}: Params): Promise<{ findings: StandardsFinding[]; notes: string[] }> => {
	const rules = collectJudgmentRules({ packs, channels });

	// Nothing to read, or nothing to read it against: no agent is spent saying so.
	if (rules.length === 0 || files.length === 0) {
		return { findings: [], notes: [] };
	}

	// One agent reads every rule against every file in one sitting, so this is
	// the slow half. Each progress line tells the reader what is happening to
	// them right now, in their own words: the review has started and roughly how
	// long that takes; it is still running, with proof of life; it finished, and
	// what it found. Every line names the review, so it stands on its own in a
	// pipeline log as much as under the command's own heading.
	const ruleCount = `${rules.length} rule${rules.length === 1 ? '' : 's'}`;

	onProgress?.(
		`The agent review is now running. ${driver.name} is reading your code against the ${ruleCount} no automated check can judge. This usually takes a few minutes.`,
	);

	const heartbeat = createAgentHeartbeat({ label: 'agent review', onProgress: (message) => onProgress?.(message) });

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

	const elapsed = formatDuration({ ms: heartbeat.elapsedMs() });

	if (!outcome.ok) {
		onProgress?.(`Agent review stopped after ${elapsed}.`);

		return { findings: [], notes: [`agent review skipped — ${outcome.failure}`] };
	}

	const result = toFindings({ reported: outcome.report.findings, known: new Set(rules.map((rule) => rule.id)) });
	const count = result.findings.length;
	const found = count === 0 ? 'nothing to report' : `${count} advisor${count === 1 ? 'y' : 'ies'} to look at`;

	onProgress?.(`✓ Agent review finished in ${elapsed} — ${found}`);

	return result;
};
