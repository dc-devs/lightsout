import type { ScanFinding } from '@/contracts';

interface Params {
	finding: ScanFinding;
}

/**
 * A finding's full text: what is true of this site, followed by what to do
 * about findings of its kind.
 *
 * The two live in separate fields so the CLI can state the guidance once per
 * group instead of once per row. Anywhere a finding becomes a single line —
 * an agent's work-list, a human's escalation message — both halves must appear
 * together, because the guidance is where a detector says what it cannot judge
 * for itself. An agent handed only the measurement would read "this function
 * is 114 lines" with nothing to tell it that orchestration is exempt.
 */
export const formatFindingText = ({ finding }: Params): string => (finding.guidance ? `${finding.detail} — ${finding.guidance}` : finding.detail);
