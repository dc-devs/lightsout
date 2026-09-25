import { z } from 'zod';
import { PlanGrade } from '#src/contracts/plan/grade/PlanGrade.ts';
import { PlanStage } from '#src/contracts/views/planWorkspace/PlanStage.ts';
import { PlanWorkspaceFile } from '#src/contracts/views/planWorkspace/PlanWorkspaceFile.ts';

/**
 * One row of the plans list.
 *
 * Stats the workspace and parses nothing but `grade.json`, so listing every
 * plan a repo has stays cheap however many it accumulates — the same bargain
 * `RunListing` strikes.
 */
export const PlanWorkspaceListing = z.object({
	/** The plan's name under its ticket folder's `plans/` — a plan address `<ticket-branch>/<plan-id>`, or a legacy folder's name. */
	name: z.string(),
	stage: z.enum(PlanStage),
	/** Present once `grade.json` exists and parses. */
	grade: z.enum(PlanGrade).optional(),
	/** `brainstorm-notes.md` exists. */
	hasNotes: z.boolean(),
	/** `plan.md` or `overview.md` exists — a drafted plan file, whatever the stage says. */
	hasPlanFile: z.boolean(),
	/** Archived phase files under `implemented/` with size and mtime, workspace-relative names; not counted in `phaseCount`. */
	implementedFiles: z.array(PlanWorkspaceFile),
	/** True when the plan is `overview.md` plus phase files rather than `plan.md`. */
	phased: z.boolean(),
	/** Phase file count; 0 for a single plan. */
	phaseCount: z.number(),
	/** Newest mtime across every file in the workspace. */
	updatedAt: z.string(),
	/** Runs that recorded this plan as the plan they belong to. */
	runCount: z.number(),
});

export type PlanWorkspaceListing = z.infer<typeof PlanWorkspaceListing>;
