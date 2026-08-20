import { z } from 'zod';
import { StructuralCheck } from '#src/contracts/plan/StructuralCheck.ts';

/**
 * One deterministic structural defect found linting a plan: which check
 * failed, what the issue is, where in the plan it is, and the exact fix.
 */
export const StructuralFinding = z.object({
	check: z.enum(StructuralCheck),
	issue: z.string(),
	location: z.string(),
	fix: z.string(),
});

export type StructuralFinding = z.infer<typeof StructuralFinding>;
