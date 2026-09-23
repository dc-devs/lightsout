import { join } from 'node:path';
import { findWorkOrderForBranch } from '#src/common/workspace/findWorkOrderForBranch.ts';
import { resolveWorktreesRoot } from '#src/worktree/resolveWorktreesRoot.ts';

interface Params {
	/** Any checkout of the repository; the primary is resolved from it. */
	cwd: string;
	branch: string;
}

/**
 * Where one branch's worktree sits: `<worktrees root>/<the work order's label>`,
 * and `<worktrees root>/<branch>` when no work order claims the branch.
 *
 * The single spelling of that layout. The creator and every caller that reports
 * or cleans up a tree it did not create compose the same path, so a future
 * change to the layout is made here rather than found in four files.
 *
 * The fallback is safe rather than a second naming rule: a branch carrying a
 * slash can only come from `queue.branch-template`, and a templated branch
 * always belongs to a work order, so the branch reaches the path only when it is
 * already its own label.
 *
 * A caller holding many branches at once should still resolve the root once with
 * `resolveWorktreesRoot` and join instead: this asks git for the primary
 * checkout on every call, which is a spawn per branch.
 */
export const resolveWorktreePath = async ({ cwd, branch }: Params): Promise<string> =>
	join(await resolveWorktreesRoot({ cwd }), (await findWorkOrderForBranch({ cwd, branch }))?.name ?? branch);
