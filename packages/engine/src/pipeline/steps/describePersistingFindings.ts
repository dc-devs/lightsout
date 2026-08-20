import { formatFindingSite, formatFindingText } from '#src/agents/index.ts';
import type { StandardsFinding, WorkReport } from '#src/contracts/index.ts';

interface Params {
	/** The work-list findings still standing — every one of them blocks. */
	findings: StandardsFinding[];
	report?: WorkReport;
	passes: number;
}

/**
 * Escalations are read by a human deciding what to do next — the message
 * must carry the evidence (what persists, where) and the agent's own
 * account of why it left the findings, not just opaque site keys that
 * send the reader digging through friction.jsonl.
 */
export const describePersistingFindings = ({ findings, report, passes }: Params): string => {
	const findingLines = findings.map((finding) => {
		const where = finding.files.map((file) => formatFindingSite({ file })).join(', ');

		return `- ${finding.siteKey} — ${formatFindingText({ finding })}\n  at ${where}`;
	});
	const rationale = (report?.friction ?? []).map((entry) => `- [${entry.area}] ${entry.detail}`);

	return [
		`refactor: standards gate — ${findings.length} blocking persist after ${passes} pass(es):`,
		...findingLines,
		...(rationale.length > 0 ? ["the refactor agent's account of its final pass:", ...rationale] : []),
	].join('\n');
};
