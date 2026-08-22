import { FindingSeverity, type StructuralFinding } from '#src/contracts/index.ts';

interface Params {
	findings: StructuralFinding[];
}

/**
 * The findings that gate: `plan lint`'s exit code, the draft's repair loop, and
 * the grade verdict all read this rather than a length, so an advisory finding
 * can never accidentally fail a plan by being counted.
 */
export const getBlockingFindings = ({ findings }: Params): StructuralFinding[] => findings.filter((finding) => finding.severity === FindingSeverity.Blocking);
