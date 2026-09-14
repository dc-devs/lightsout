/**
 * A plan's address: its ticket folder and its plan id, joined by one slash —
 * `lo-140-multi/001-record`.
 *
 * The address is the `--name` value every plan command takes and the path
 * segment under the plans directory the plan's own files live in. The branch,
 * the worktree and the worktree's ownership record are keyed by `ticketBranch`
 * alone, because every plan of one ticket implements on that one branch.
 */
export interface PlanAddress {
	ticketBranch: string;
	planId: string;
}
