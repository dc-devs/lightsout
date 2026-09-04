import { execSync } from 'node:child_process';

interface Params {
	/** A git worktree. */
	cwd: string;
}

/** The subject line of the newest commit on the branch a worktree stands on. */
export const headSubject = ({ cwd }: Params): string => execSync('git log -1 --pretty=%s', { cwd }).toString().trim();
