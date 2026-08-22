import { FindingSeverity, type StructuralFinding } from '#src/contracts/index.ts';

interface Params {
	findings: StructuralFinding[];
}

/**
 * The findings a caller prints rather than acts on — the complement of
 * `getBlockingFindings`, and the reason both exist as named predicates: a bare
 * severity filter written at each seam is one negation away from gating on the
 * wrong half.
 */
export const getAdvisoryFindings = ({ findings }: Params): StructuralFinding[] => findings.filter((finding) => finding.severity === FindingSeverity.Advisory);
