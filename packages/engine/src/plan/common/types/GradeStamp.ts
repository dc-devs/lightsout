/** Which code a grade was measured against: what `readGradeStamp` probes, named once so the passes that carry it around cannot drift from it. */
export interface GradeStamp {
	/** The commit `HEAD` was at, or `undefined` outside a git worktree. */
	commit: string | undefined;
	/** Whether uncommitted work sat beside it — `undefined` means the tree was NOT READ, never that it was read and found clean. */
	treeDirty: boolean | undefined;
}
