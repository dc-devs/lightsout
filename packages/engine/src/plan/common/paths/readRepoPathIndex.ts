import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { RepoPathIndex } from '#src/plan/common/types/RepoPathIndex.ts';

/** The two names that are never a file a plan claims: a dependency tree and git's own object store. */
const prunedDirs = new Set(['node_modules', '.git']);

interface Params {
	cwd: string;
}

/** One directory's entries, or undefined when it could not be read at all. */
const readEntries = ({ dir }: { dir: string }) => readdir(dir, { withFileTypes: true }).catch(() => undefined);

/**
 * Every file under `dir`, repo-relative — or undefined when ANY directory below
 * it could not be read.
 *
 * `listSourceFiles` catches per directory and accepts a partial answer, because
 * a few unchecked files there cost a few unreported findings. Here a partial
 * answer costs a blocked plan, silently: the caller's degraded-index guard fires
 * only on an empty pool, so a pool missing one unreadable subtree reports every
 * file under it as absent with nothing signalling that anything went wrong.
 */
const walkFiles = async ({ cwd, dir, entries }: { cwd: string; dir: string; entries: Dirent[] }): Promise<string[] | undefined> => {
	const files: string[] = [];

	for (const entry of entries) {
		if (prunedDirs.has(entry.name)) {
			continue;
		}

		const path = join(dir, entry.name);

		if (!entry.isDirectory()) {
			files.push(relative(cwd, path));
			continue;
		}

		const nested = await readEntries({ dir: path });
		const below = nested === undefined ? undefined : await walkFiles({ cwd, dir: path, entries: nested });

		if (below === undefined) {
			return undefined;
		}

		files.push(...below);
	}

	return files;
};

/**
 * Read the working tree once: the directory names directly under the root, and
 * every file beneath it.
 *
 * The file pool deliberately does NOT come from `listSourceFiles`. That walk
 * answers "which files do the standards checks read", and its answer omits
 * files that really exist — `.d.ts` declarations, everything under a dot
 * directory, build output sitting beside a `src` folder, and every standards-
 * pack `fixtures/` tree. Each carries a `.ts` or `.js` extension, so a
 * shorthand naming one would be judged against a pool that cannot contain it
 * and reported missing. A check that BLOCKS a plan may not rest on a
 * deliberately partial pool.
 *
 * Dot directories are kept: `.lightsout` and `.claude` are real anchors a plan
 * names. An unreadable root yields an empty index, which the caller reads as
 * "the tree could not be seen" rather than "nothing exists".
 */
export const readRepoPathIndex = async ({ cwd }: Params): Promise<RepoPathIndex> => {
	const entries = await readEntries({ dir: cwd });
	const topLevelDirs = new Set((entries ?? []).filter((entry) => entry.isDirectory() && !prunedDirs.has(entry.name)).map((entry) => entry.name));
	const files = entries === undefined ? undefined : await walkFiles({ cwd, dir: cwd, entries });

	return { topLevelDirs, files: files ?? [] };
};
