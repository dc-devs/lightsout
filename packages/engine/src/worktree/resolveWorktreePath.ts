import { join } from 'node:path';
import { resolveWorktreesRoot } from '#src/worktree/resolveWorktreesRoot.ts';

interface Params {
	/** Any checkout of the repository; the primary is resolved from it. */
	cwd: string;
	branch: string;
}

/**
 * Where one branch's worktree sits: `<worktrees root>/<branch>`.
 *
 * The single spelling of that layout. The creator and every caller that
 * reports or cleans up a tree it did not create compose the same path, so a
 * future change to the layout — a slug, a nesting level, an owner segment —
 * is made here rather than found in four files.
 *
 * A caller holding many branches at once should resolve the root once with
 * `resolveWorktreesRoot` and join instead: this asks git for the primary
 * checkout on every call, which is a spawn per branch.
 */
export const resolveWorktreePath = async ({ cwd, branch }: Params): Promise<string> => join(await resolveWorktreesRoot({ cwd }), branch);
