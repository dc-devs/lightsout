/**
 * Where the scan sends one parked worktree once the merge and finished
 * questions have both answered no.
 *
 * Three values, each naming what happens next rather than what the tree looks
 * like: `Drain` sends the branch back to a worker, `Ship` sends it to the merge,
 * and `Unreadable` is git declining to answer at all — reported rather than
 * guessed at.
 */
export const ParkedTreeBucket = {
	Unreadable: 'unreadable',
	Drain: 'drain',
	Ship: 'ship',
} as const;

export type ParkedTreeBucket = (typeof ParkedTreeBucket)[keyof typeof ParkedTreeBucket];
