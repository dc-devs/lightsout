import { z } from 'zod';
import { GapCheckLens } from '#src/contracts/plan/grade/GapCheckLens.ts';
import { GradedGap } from '#src/contracts/plan/grade/GradedGap.ts';
import { PhaseWeight } from '#src/contracts/plan/grade/PhaseWeight.ts';
import { PlanGrade } from '#src/contracts/plan/grade/PlanGrade.ts';
import { StructuralFinding } from '#src/contracts/plan/grade/StructuralFinding.ts';
import { GradeInputs } from '#src/contracts/plan/memory/GradeInputs.ts';
import { GradeScope } from '#src/contracts/plan/memory/GradeScope.ts';

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
 *
 * `complete` speaks for the whole plan rather than for this one pass: every plan
 * file is covered at its current text — by this pass or by a recorded earlier
 * one — the whole-plan documentation record stands, and nothing failed or was
 * withheld. A reader that failed or hit the wall leaves a plan file uncovered,
 * so the pass is incomplete; a judge that failed leaves one finding unweighed,
 * which is recorded as `unjudged` on that gap and blocks the grade on its own —
 * the pass still finished.
 *
 * `scopeComplete` answers a narrower question than `complete`: whether every
 * check THIS pass's own scope called for finished. A focused repair pass that
 * read every phase it owed is scope-complete whether or not the plan beside it
 * is covered. `complete` decides approval; `scopeComplete` decides only whether
 * the pass may become the baseline the next repair narrows against.
 *
 * `gradedAt` alone cannot tell a stale verdict from a current one: a grade taken
 * against code that has since moved on reads exactly like a fresh one. The
 * commit stamp beside it says WHAT was measured, not merely when.
 */
export const GradeReport = z.object({
	planName: z.string(),
	grade: z.enum(PlanGrade),
	structural: z.array(StructuralFinding).default([]),
	gaps: z.array(GradedGap).default([]),
	/** The plan files every lens returned for — a pass that did not finish cannot read as a clean bill. */
	phasesChecked: z.array(z.string()).default([]),
	/** The lenses each of those files was checked with. Empty when no reader ran at all, which is what a grade of only light files reads as. */
	lenses: z.array(z.enum(GapCheckLens)).default([]),
	/** Each graded plan file's weight and why. Empty on a grade taken with `plan.contract` off. */
	weights: z.array(PhaseWeight).default([]),
	/** The plan files no reader read because they weighed light. Never overlaps `phasesChecked`. */
	phasesLight: z.array(z.string()).default([]),
	/** True when every plan file is covered at its current text — by this pass or a recorded earlier one — and nothing failed or was withheld. A failed judge leaves its gap `unjudged` instead of making the pass incomplete. */
	complete: z.boolean().default(true),
	/** True when every check this pass's own scope called for finished — never a whole-plan clean bill, and never an approval. Defaults to `false` so a report written before the field existed claims no coverage. */
	scopeComplete: z.boolean().default(false),
	/** Why the pass did not finish, absent when it did. */
	incompleteReason: z.string().optional(),
	passed: z.boolean(),
	gradedAt: z.string(),
	/** The commit `HEAD` was at when the grade was taken, absent outside a git worktree. `gradedAt` says when; this says against what. */
	gradedCommit: z.string().optional(),
	/** True when the working tree held uncommitted changes at grade time, so `gradedCommit` is a floor rather than an exact description of what was measured. Absent means NOT KNOWN — no commit was read, or the changed-file probe itself failed. It never means clean; only `false` means clean. */
	gradedTreeDirty: z.boolean().optional(),
	/** How far this pass reached. Defaults to `full` so a report written before the field existed reads as the whole-plan pass it was. */
	scope: z.enum(GradeScope).default(GradeScope.Full),
	/** The plan files a focused pass read — the edited phases and their connected closure. Empty on a full pass. */
	focusedOn: z.array(z.string()).default([]),
	/** The plan files covered at their current text when the pass ended, by this pass or by a recorded earlier one. Defaults to empty so a report written before the field claims no coverage — it is what the terminal line reads to tell a reading from a reuse. */
	covered: z.array(z.string()).default([]),
	/** The fingerprint of everything this pass measured. Absent on a report written before the field existed, which is never treated as matching anything. */
	inputs: GradeInputs.optional(),
	/** One line naming the rule that chose this pass's scope, persisted so a history line says why the pass reached as far as it did. Absent on a report written before the field existed and on a preflight stop. */
	scopeReason: z.string().optional(),
});

export type GradeReport = z.infer<typeof GradeReport>;
