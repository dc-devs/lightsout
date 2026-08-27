import { execFileSync } from 'node:child_process';

/**
 * Every commit that changed TypeScript under `packages/`, oldest first.
 *
 * The sprawl animation is about the shape of the source tree, so a commit that
 * only touched a README or a lockfile is not a frame — it would hold the
 * picture still for no reason a viewer could see.
 *
 * The sha is abbreviated here rather than by git, whose abbreviation length
 * grows with the object count: `%h` would rewrite every line of the dataset the
 * day the repo crosses that threshold, and this file has to be byte-identical
 * between rebuilds at the same HEAD.
 *
 * @param repoRoot - the repository to read
 */
export const readSprawlCommits = ({ repoRoot }) => {
	const output = execFileSync('git', ['log', '--reverse', '--format=%H%x09%aI%x09%s', '--', 'packages/**/*.ts', 'packages/**/*.tsx'], {
		cwd: repoRoot,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});

	return output
		.split('\n')
		.filter((line) => line.length > 0)
		.map((line) => {
			const [sha, at, ...subject] = line.split('\t');

			// A subject may itself contain a tab, so the remainder is rejoined
			// rather than the third field being taken alone.
			return { sha: sha.slice(0, 7), at, subject: subject.join('\t') };
		});
};
