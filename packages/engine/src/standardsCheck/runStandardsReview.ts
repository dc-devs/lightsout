import { buildStandardsReviewInvocation } from '@/agents';
import { Permissions, type StandardsFinding, StandardsReviewReport, StandardsSeverity } from '@/contracts';
import type { Driver } from '@/drivers';
import { invokeAgentWithContract } from '@/invoke';
import type { LoadedStandardsPackage } from '@/standardsPackages';

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

	onProgress?.(`agent review: ${rules.length} judgment rule(s) over ${files.length} file(s)`);

	const outcome = await invokeAgentWithContract({
		driver,
		cwd,
		invocation: buildStandardsReviewInvocation({ rules, files }),
		contract: StandardsReviewReport,
		permissions: Permissions.ReadOnly,
		timeoutMs,
	});

	if (!outcome.ok) {
		return { findings: [], notes: [`agent review skipped — ${outcome.failure}`] };
	}

	return toFindings({ reported: outcome.report.findings, known: new Set(rules.map((rule) => rule.id)) });
};
