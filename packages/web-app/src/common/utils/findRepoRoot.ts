import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

/**
 * The repo whose `.lightsout/` this app reads, when one was found at all:
 * `LIGHTSOUT_REPO` when set, otherwise the nearest ancestor of the working
 * directory holding a `lightsout.config.json`, and `undefined` when no ancestor
 * holds one.
 *
 * The walk is what makes the default useful. `pnpm start:dev` starts the server
 * with `packages/web-app` as its working directory, so a plain `process.cwd()`
 * would look for run state inside the app package and show an empty list
 * forever. `lightsout.config.json` is the marker because it is what makes a
 * directory a lightsout consumer — a fresh clone has no `.lightsout/` yet.
 *
 * Which repo, and nothing about whether one may be read: that is
 * `isPublicDeployment`'s question, and `requireLocalRepoRoot` asks it first.
 *
 * Resolved on every call and never cached in module scope, so a dev server
 * restarted with a different value picks it up.
 */
export const findRepoRoot = (): string | undefined => {
	const configured = process.env.LIGHTSOUT_REPO;

	if (configured !== undefined && configured !== '') {
		return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
	}

	let directory = process.cwd();
	let root: string | undefined;
	let searching = true;

	while (searching) {
		const parent = dirname(directory);

		if (existsSync(resolve(directory, 'lightsout.config.json'))) {
			root = directory;
			searching = false;
		} else if (parent === directory) {
			searching = false;
		} else {
			directory = parent;
		}
	}

	return root;
};
