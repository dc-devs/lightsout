import { formatFindingSite, formatFindingText } from '@/agents';
import type { ScanFinding, WorkReport } from '@/contracts';

interface Params {
	gating: ScanFinding[];
	report?: WorkReport;
	passes: number;
}

/**
 * Escalations are read by a human deciding what to do next — the message
 * must carry the evidence (what persists, where) and the agent's own
 * account of why it left the findings, not just opaque cluster ids that
 * send the reader digging through friction.jsonl.
 */
export const describePersistingFindings = ({ gating, report, passes }: Params): string => {
	const findingLines = gating.map((finding) => {
		const where = finding.files.map((file) => formatFindingSite({ file })).join(', ');

		return `- ${finding.cluster} — ${formatFindingText({ finding })}\n  at ${where}`;
	});
	const rationale = (report?.friction ?? []).map((entry) => `- [${entry.area}] ${entry.detail}`);

	return [
		`refactor: scan gate — ${gating.length} finding(s) persist after ${passes} pass(es):`,
		...findingLines,
		...(rationale.length > 0 ? ["the refactor agent's account of its final pass:", ...rationale] : []),
	].join('\n');
};
