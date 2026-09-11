/**
 * Who a worktree belongs to.
 *
 * Three entry points place a ticket's tree at the same path on the same branch,
 * so nothing about the directory or the branch name tells them apart. The owner
 * is recorded durably beside the branch instead: `Queue` for a tree a drain
 * cut, `Implement` for one a standalone implementation run cut, `Plan` for one
 * a planning session cut. A drain leaves a tree it does not own exactly where
 * it is.
 *
 * The one asymmetry: planning continues in a tree recorded to `Queue` without
 * re-stamping it, while an implementation run continues in a tree recorded to
 * `Plan` and DOES re-stamp it to `Implement`, because ownership is what
 * licenses the post-ship removal.
 */
export const WorktreeOwner = {
	Queue: 'queue',
	Implement: 'implement',
	Plan: 'plan',
} as const;

export type WorktreeOwner = (typeof WorktreeOwner)[keyof typeof WorktreeOwner];
