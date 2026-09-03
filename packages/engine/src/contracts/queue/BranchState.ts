import { z } from 'zod';
import { BranchPhase } from '#src/contracts/queue/BranchPhase.ts';

/**
 * What the queue last recorded about one branch, written to
 * `.lightsout/branch-state/<branch>.json` in the MAIN checkout.
 *
 * It lives in the main checkout rather than the worktree so it outlives the
 * worktree the ship step removes, and it is never deleted: a merged record is
 * exactly what keeps a finished branch away from the next worker.
 */
export const BranchState = z.object({
	/** The branch the record describes, as git names it. */
	branch: z.string(),
	phase: z.enum(BranchPhase),
	/** ISO timestamp of the write that last changed the phase. */
	updatedAt: z.string(),
});

export type BranchState = z.infer<typeof BranchState>;
