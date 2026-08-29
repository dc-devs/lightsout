import { basename, dirname, join, resolve } from 'node:path';

interface Params {
	/** The main repository checkout. */
	cwd: string;
}

/**
 * Where the queue's worktrees live: `<parent of cwd>/<name of cwd>-worktrees`.
 *
 * A sibling directory beside the repo, never inside it, so nothing that walks
 * up looking for a repository root finds the wrong one. `cwd` is resolved to an
 * absolute path first, so a relative `--cwd` cannot produce a path carrying
 * `..`.
 *
 * It answers the root rather than a per-ticket path deliberately: a
 * slash-bearing branch template nests directories under this root, so the
 * branch is joined onto it by the caller that knows the branch, and the resume
 * scan filters `git worktree list` entries by this root alone.
 */
export const getWorktreesRoot = ({ cwd }: Params): string => {
	const repo = resolve(cwd);

	return join(dirname(repo), `${basename(repo)}-worktrees`);
};
