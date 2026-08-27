import type { PlanWorkspaceFile } from '#src/contracts/index.ts';

/**
 * Every file a plan workspace holds, bucketed by the role its name gives it.
 *
 * Named rather than restated at each call site: the walk produces this shape and
 * the listing builder consumes it, so a hand-copied inline type would be a
 * second contract that drifts the moment a bucket is added.
 */
export interface PlanWorkspaceFiles {
	/** `overview.md` when the workspace has one, else `plan.md`. */
	planFile?: PlanWorkspaceFile;
	/** `phase<N>-<slug>.md`, in numeric order. */
	phaseFiles: PlanWorkspaceFile[];
	notesFile?: PlanWorkspaceFile;
	/** Files ending `-stream.jsonl` — named and sized, never read. */
	transcripts: PlanWorkspaceFile[];
	/** Archived `implemented/phase<N>-*.md`, workspace-relative. Never in `phaseFiles`, `phaseCount` or `updatedAt`. */
	implementedFiles: PlanWorkspaceFile[];
	/** Every other top-level file — `facts.json`, `grade.json`, `decisions.json`, `dedup.json` — keyed by file name, for the callers that ask "does this workspace have X?". */
	others: Map<string, PlanWorkspaceFile>;
	/** Newest mtime across the top level; the folder's own mtime when it holds no files. */
	updatedAt: string;
}
