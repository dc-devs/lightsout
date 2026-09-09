import { formatFindingSite } from '#src/common/findings/formatFindingSite.ts';
import { formatFindingText } from '#src/common/findings/formatFindingText.ts';
import type { StandardsFinding, WorkReport } from '#src/contracts/index.ts';

interface Params {
	/** The qualifying blocking findings still standing when cleanup ended. */
	findings: StandardsFinding[];
	report?: WorkReport;
	/** Executor rounds cleanup spent before it ended. */
	roundsUsed: number;
}

/**
 * The recorded account of what bounded cleanup left behind — written to
 * progress and to the step report's `narration` while the run carries on to
 * normal verification.
 *
 * It is not an escalation and must never read as one: nothing here stops a run.
 * It still carries the evidence that made the old escalation worth reading —
 * what is still standing and where, plus the agent's own account of why it left
 * the findings — because a reader who later decides to act on this needs the
 * sites, not opaque keys that send them digging through friction.jsonl.
 */
export const describePersistingFindings = ({ findings, report, roundsUsed }: Params): string => {
	const findingLines = findings.map((finding) => {
		const where = finding.files.map((file) => formatFindingSite({ file })).join(', ');

		return `- ${finding.siteKey} — ${formatFindingText({ finding })}\n  at ${where}`;
	});
	const rationale = (report?.friction ?? []).map((entry) => `- [${entry.area}] ${entry.detail}`);

	return [
		`refactor: cleanup ended with ${findings.length} qualifying blocking finding(s) still standing after ${roundsUsed} round(s) — recorded, and the run carries on:`,
		...findingLines,
		...(rationale.length > 0 ? ["the cleanup agent's account of its final round:", ...rationale] : []),
	].join('\n');
};
