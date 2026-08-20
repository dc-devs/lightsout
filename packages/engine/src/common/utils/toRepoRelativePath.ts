import { relative, resolve } from 'node:path';

interface Params {
	cwd: string;
	/** A path as a caller named it — cwd-relative or absolute. */
	path: string;
}

/**
 * The one form a path takes on disk in run state: relative to the target repo.
 *
 * A relative path is kept as it stands, an absolute one is rewritten relative to
 * `cwd` — so the same file named either way is recorded the same way, every
 * reader can join the record onto `cwd`, and a guard comparing two records sees
 * one plan rather than two. A path outside the repo stays reachable as a `../`
 * route. The empty path is its own relative form.
 */
export const toRepoRelativePath = ({ cwd, path }: Params): string => relative(cwd, resolve(cwd, path));
