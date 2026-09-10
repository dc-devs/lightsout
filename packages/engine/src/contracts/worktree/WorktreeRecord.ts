import { z } from 'zod';
import { WorktreeOwner } from '#src/contracts/worktree/WorktreeOwner.ts';

/**
 * Who made one worktree, written to `.lightsout/worktrees/<branch>.json` in the
 * PRIMARY checkout.
 *
 * It lives in the primary checkout rather than in the tree it describes, for
 * the reason `BranchState` does: the record has to outlive the removal it
 * attributes, and every linked worktree of one repository has to read the same
 * file. Its caller deletes it after a removal that worked, so a tree that
 * survived a failed removal keeps the record naming its owner.
 */
export const WorktreeRecord = z.object({
	/** The branch the tree is checked out on, as git names it. */
	branch: z.string(),
	owner: z.enum(WorktreeOwner),
	/** The tree's absolute path, as the creator spelled it. */
	worktreePath: z.string(),
	/** ISO timestamp of the creation this record describes. */
	createdAt: z.string(),
});

export type WorktreeRecord = z.infer<typeof WorktreeRecord>;
