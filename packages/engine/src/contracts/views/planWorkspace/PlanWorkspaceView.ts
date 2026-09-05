import { z } from 'zod';
import { DedupReport } from '#src/contracts/dedup/index.ts';
import { BrainstormDecisions, DecisionsRecord, GradeReport, PlanFacts } from '#src/contracts/plan/index.ts';
import { PlanWorkspaceFile } from '#src/contracts/views/planWorkspace/PlanWorkspaceFile.ts';
import { PlanWorkspaceListing } from '#src/contracts/views/planWorkspace/PlanWorkspaceListing.ts';
import { RunListing } from '#src/contracts/views/RunListing.ts';

/**
 * One plan workspace as its page shows it: the listing row, the files it holds,
 * every record that parsed, and the runs that implemented it.
 *
 * Each record is optional because a workspace is built up over several commands
 * and is readable at every point in between — and `problems` is what keeps that
 * leniency honest, naming each file that exists and would not parse rather than
 * letting it read as absent.
 */
export const PlanWorkspaceView = z.object({
	listing: PlanWorkspaceListing,
	/** Absolute workspace folder. */
	rootPath: z.string(),
	/** `plan.md`, or `overview.md`, whichever the workspace has; absent before drafting. */
	planFile: PlanWorkspaceFile.optional(),
	/** `phase<N>-<slug>.md` files in numeric order; empty for a single plan. */
	phaseFiles: z.array(PlanWorkspaceFile).default([]),
	/** `brainstorm-notes.md`, when `/brainstorm` wrote one. */
	notesFile: PlanWorkspaceFile.optional(),
	facts: PlanFacts.optional(),
	decisions: DecisionsRecord.optional(),
	brainstormDecisions: BrainstormDecisions.optional(),
	grade: GradeReport.optional(),
	dedup: DedupReport.optional(),
	/** Agent transcripts, named and sized but never read. */
	transcripts: z.array(PlanWorkspaceFile).default([]),
	/** Every run whose `plan` path sits inside this workspace, newest first. */
	runs: z.array(RunListing).default([]),
	/** One line per file that exists but would not parse — a corrupt workspace is shown, not hidden. */
	problems: z.array(z.string()).default([]),
});

export type PlanWorkspaceView = z.infer<typeof PlanWorkspaceView>;
