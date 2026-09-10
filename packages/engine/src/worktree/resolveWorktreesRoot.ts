import { basename, dirname, join, resolve } from 'node:path';
import { readGitPrimaryCheckout } from '#src/common/git/readGitPrimaryCheckout.ts';

interface Params {
	/** Any checkout of the repository — a primary checkout, a linked worktree, or no repository at all. */
	cwd: string;
}

/**
 * Where a repository's worktrees live: `<parent of the primary checkout>/<name
 * of the primary checkout>-worktrees`.
 *
 * A sibling directory beside the repo, never inside it, so nothing that walks
 * up looking for a repository root finds the wrong one. The directory it is
 * computed from is the PRIMARY checkout rather than `cwd`, the same shape
 * `resolveSharedStateDir` uses: a command launched from a linked worktree
 * otherwise cuts a second worktrees root inside the first one. Outside a
 * repository there is no primary to resolve, so `cwd` answers for itself and
 * nothing that works today starts failing. Either way the directory is resolved
 * absolute first, so a relative `--cwd` cannot produce a path carrying `..`.
 *
 * It answers the root alone, for the callers that hold no single branch: the
 * resume scan filters `git worktree list` entries by this root, and the queue
 * plan lists many branches from one resolution. A caller that knows its branch
 * asks `resolveWorktreePath` instead of joining the two itself.
 */
export const resolveWorktreesRoot = async ({ cwd }: Params): Promise<string> => {
	const primary = await readGitPrimaryCheckout({ cwd });
	const repo = resolve(primary ?? cwd);

	return join(dirname(repo), `${basename(repo)}-worktrees`);
};
