import { z } from 'zod';
import { PlanGap } from '#src/contracts/plan/grade/PlanGap.ts';
import { PlanGrade } from '#src/contracts/plan/grade/PlanGrade.ts';
import { StructuralFinding } from '#src/contracts/plan/grade/StructuralFinding.ts';

/**
 * The persisted `grade.json`: a plan's grade plus the evidence behind it — the
 * deterministic structural findings and the agent-found decision gaps. `passed`
 * is the typed verdict the skill reads; it never re-implements a check.
 */
export const GradeReport = z.object({
	planName: z.string(),
	grade: z.enum(PlanGrade),
	structural: z.array(StructuralFinding).default([]),
	gaps: z.array(PlanGap).default([]),
	passed: z.boolean(),
	gradedAt: z.string(),
});

export type GradeReport = z.infer<typeof GradeReport>;
