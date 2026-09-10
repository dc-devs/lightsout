/**
 * Who a worktree belongs to.
 *
 * Two entry points place a ticket's tree at the same path on the same branch,
 * so nothing about the directory or the branch name tells them apart. The owner
 * is recorded durably beside the branch instead: `Queue` for a tree a drain
 * cut, `Implement` for one a standalone implementation run cut. A drain leaves
 * a tree it does not own exactly where it is.
 */
export const WorktreeOwner = {
	Queue: 'queue',
	Implement: 'implement',
} as const;

export type WorktreeOwner = (typeof WorktreeOwner)[keyof typeof WorktreeOwner];
