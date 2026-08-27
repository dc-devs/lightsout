import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { standardsPackRootFile } from '#src/common/constants/standardsPackRootFile.ts';

interface Params {
	cwd: string;
}

/**
 * The authored default pack's folder — the one that still has its fixtures — or
 * `undefined` when none is beside `cwd`.
 *
 * A sibling of `resolveDefaultStandardsPack`, not a replacement for it: that one
 * deliberately finds the SHIPPED copy beside the running program, which a run
 * loads and which carries no fixture pairs. A pack page has to show the examples
 * a rule argues from, so it looks for the authored folder first and falls back to
 * the shipped one when there is none — which is the normal case on any repo that
 * is neither this monorepo nor itself a pack.
 *
 * Synchronous, for the same reason its sibling is: it runs once per read.
 *
 * @param cwd - the repo whose folders are searched
 * @returns the absolute folder, or `undefined` when the caller should fall back to the shipped copy
 */
export const resolveAuthoredStandardsPack = ({ cwd }: Params): string | undefined => {
	// The same override `resolveDefaultStandardsPack` honours, so this repo's own
	// suites and dev server agree with the engine about which pack is the default.
	const override = process.env.LIGHTSOUT_DEFAULT_STANDARDS;
	const candidates = [
		...(override === undefined ? [] : [resolve(override)]),
		// This monorepo's authored pack, then a repo that IS a pack.
		join(cwd, 'packages', 'standards-typescript'),
		resolve(cwd),
	];

	return candidates.find((candidate) => existsSync(join(candidate, standardsPackRootFile)));
};
