import { z } from 'zod';
import { BranchPhase } from '#src/contracts/queue/BranchPhase.ts';

/**
 * What the queue last recorded about one branch, written to
 * `branch-state.json` in that branch's ticket folder.
 *
 * It lives in the primary checkout rather than the worktree so it outlives the
 * worktree the ship step removes — any checkout asking resolves there — and it
 * is never deleted: a merged record is exactly what keeps a finished branch
 * away from the next worker.
 */
export const BranchState = z.object({
	/** The branch the record describes, as git names it. */
	branch: z.string(),
	phase: z.enum(BranchPhase),
	/** ISO timestamp of the write that last changed the phase. */
	updatedAt: z.string(),
});

export type BranchState = z.infer<typeof BranchState>;
