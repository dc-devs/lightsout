import { z } from 'zod';
import { GapCheckLens } from '#src/contracts/plan/grade/GapCheckLens.ts';
import { GradedGap } from '#src/contracts/plan/grade/GradedGap.ts';
import { PlanGrade } from '#src/contracts/plan/grade/PlanGrade.ts';
import { StructuralFinding } from '#src/contracts/plan/grade/StructuralFinding.ts';

/**
 * The persisted `grade.json`: a plan's grade plus the evidence behind it — the
 * deterministic structural findings and the agent-found decision gaps. `passed`
 * is the typed verdict the skill reads; it never re-implements a check.
 *
 * The coverage fields are what keep a partial pass honest. A checker that fails
 * or hits the rate-limit wall no longer discards everything its siblings found;
 * the report is written with `complete: false` and a `phasesChecked` naming only
 * the files every lens returned for, so a pass that did not finish can never be
 * skimmed as a clean bill. A `complete: false` report is never an A, whatever it
 * found.
 */
export const GradeReport = z.object({
	planName: z.string(),
	grade: z.enum(PlanGrade),
	structural: z.array(StructuralFinding).default([]),
	gaps: z.array(GradedGap).default([]),
	/** The plan files every lens returned for — a pass that did not finish cannot read as a clean bill. */
	phasesChecked: z.array(z.string()).default([]),
	/** The lenses each of those files was checked with. */
	lenses: z.array(z.enum(GapCheckLens)).default([]),
	/** False when a checker failed or hit the rate-limit wall; the findings below are real but partial. */
	complete: z.boolean().default(true),
	/** Why the pass did not finish, absent when it did. */
	incompleteReason: z.string().optional(),
	passed: z.boolean(),
	gradedAt: z.string(),
});

export type GradeReport = z.infer<typeof GradeReport>;
