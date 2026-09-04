import { execSync } from 'node:child_process';

interface Params {
	/** A git worktree. */
	cwd: string;
}

/** The repo-relative paths the newest commit on the branch actually carries. */
export const committedPaths = ({ cwd }: Params): string[] =>
	execSync('git show --name-only --pretty=format: HEAD', { cwd }).toString().split('\n').filter(Boolean);
