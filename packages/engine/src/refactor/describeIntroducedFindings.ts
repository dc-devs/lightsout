import { formatFindingSite, formatFindingText } from '#src/agents/index.ts';
import type { StandardsFinding } from '#src/contracts/index.ts';

interface Params {
	/** What the run introduced, from findIntroducedFindings. */
	findings: StandardsFinding[];
}

/**
 * The introduced findings as the run-ending error a human reads.
 *
 * It carries the evidence — what appeared and where — because the reader's
 * first question is which edit did this, and a bare count cannot answer it.
 * The closing line says where the work is, since the engine never commits and
 * the changes are sitting in the tree unreviewed.
 */
export const describeIntroducedFindings = ({ findings }: Params): string =>
	[
		`refactor introduced ${findings.length} blocking finding(s) it never set out to fix:`,
		...findings.map(
			(finding) => `- ${finding.siteKey} — ${formatFindingText({ finding })}\n  at ${finding.files.map((file) => formatFindingSite({ file })).join(', ')}`,
		),
		'The run’s changes are in the working tree — review them, fix these, and re-run.',
	].join('\n');
