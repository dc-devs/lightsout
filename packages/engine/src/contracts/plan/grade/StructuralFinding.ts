import { z } from 'zod';
import { FindingSeverity } from '#src/contracts/plan/grade/FindingSeverity.ts';
import { StructuralCheck } from '#src/contracts/plan/grade/StructuralCheck.ts';

/**
 * One deterministic structural defect found linting a plan: which check
 * failed, how hard it gates, which plan file it is in, what the issue is,
 * where in the plan it is, and the exact fix.
 */
export const StructuralFinding = z.object({
	check: z.enum(StructuralCheck),
	/**
	 * Blocking unless stated — an advisory finding prints and gates nothing.
	 *
	 * The default is for parsing a persisted `grade.json` written before this
	 * field existed, NOT permission for a construction site to omit it: every
	 * producer in this repo builds a finding as an object literal and knows
	 * exactly which of the two it is reporting.
	 */
	severity: z.enum(FindingSeverity).default(FindingSeverity.Blocking),
	/** Which plan file the defect is in: a phase file's basename, `overview.md`, or `plan.md`. */
	phase: z.string(),
	issue: z.string(),
	location: z.string(),
	fix: z.string(),
});

export type StructuralFinding = z.infer<typeof StructuralFinding>;
