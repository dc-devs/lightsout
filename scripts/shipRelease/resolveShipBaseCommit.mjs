import { runGit } from './runGit.mjs';

/**
 * The commit a shipped version is measured against: the one ship pinned, or the
 * fork point a manual run falls back to.
 *
 * Ship has already fetched and merged its commit, so the shipped version has to
 * clear THAT rather than the fork point the two branches still share. A pinned
 * commit git cannot resolve is a problem rather than a reason to fall back —
 * the engine only pins a commit it has merged, so an unresolvable one means the
 * tree is not what the caller was told it is.
 *
 * One resolver for both scripts: `preShip.mjs` bumps against this answer and
 * `checkShipped.mjs` verifies against it, so two statements of the rule could
 * disagree about which commit the release was prepared for. Each caller keeps
 * its own error policy — the hook throws, the check collects.
 *
 * @param base - git ref the fork point is taken from when no exact commit is pinned
 * @param baseCommit - the exact commit to use, overriding `base`. Defaults to `LIGHTSOUT_SHIP_BASE_COMMIT`.
 * @returns the resolved commit and whether it was pinned, or the problem, or why the question was skipped
 */
export const resolveShipBaseCommit = ({ base = 'origin/main', baseCommit } = {}) => {
	const pinned = baseCommit ?? process.env.LIGHTSOUT_SHIP_BASE_COMMIT;

	if (pinned === undefined || pinned === '') {
		const forkPoint = runGit({ args: ['merge-base', base, 'HEAD'] });

		return forkPoint === undefined ? { skipped: `version not checked: no ${base} to compare against` } : { baseCommit: forkPoint, pinned: false };
	}

	const resolved = runGit({ args: ['rev-parse', '--verify', `${pinned}^{commit}`] });

	return resolved === undefined ? { problem: `the pinned base commit is not a commit in this repository: ${pinned}` } : { baseCommit: resolved, pinned: true };
};
