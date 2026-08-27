import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

/**
 * The repo whose `.lightsout/` this app reads, when one was found at all:
 * `LIGHTSOUT_REPO` when set, otherwise the nearest ancestor of the working
 * directory holding a `lightsout.config.json`, and `undefined` when no ancestor
 * holds one.
 *
 * The walk is what makes the default useful. `pnpm dev:web` starts the server
 * with `packages/web-app` as its working directory, so a plain `process.cwd()`
 * would look for run state inside the app package and show an empty list
 * forever. `lightsout.config.json` is the marker because it is what makes a
 * directory a lightsout consumer — a fresh clone has no `.lightsout/` yet.
 *
 * `LIGHTSOUT_PUBLIC=1` answers `undefined` before any walk: a public deployment
 * started from inside a checkout would otherwise find that checkout's own
 * config and offer a "Your repo" zone pointing at the server's disk.
 *
 * The one place the question is asked, so the navigation and the reader switch
 * cannot disagree about whether a repo is open: `undefined` is what leaves the
 * "Your repo" zone out of the shell and what puts `getReader` on the fixtures.
 *
 * Resolved on every call and never cached in module scope, so a dev server
 * restarted with a different value picks it up.
 */
export const findRepoRoot = (): string | undefined => {
	if (process.env.LIGHTSOUT_PUBLIC === '1') {
		return undefined;
	}

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
