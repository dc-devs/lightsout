import { spawnSync } from 'node:child_process';
import { repoRoot } from './repoRoot.mjs';

/**
 * A git command's stdout, or undefined when git exits non-zero (an unknown ref,
 * usually).
 *
 * `spawnSync` rather than `execFileSync`, so an unknown ref is a return value
 * instead of a thrown error every caller has to wrap.
 *
 * @param args - the git arguments, already split
 * @returns trimmed stdout, or undefined when git refused the command
 */
export const runGit = ({ args }) => {
	const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

	return result.status === 0 ? result.stdout.trim() : undefined;
};
