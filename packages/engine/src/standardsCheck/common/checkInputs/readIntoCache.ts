import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Params {
	cwd: string;
	/** Repo-relative paths to make available. */
	paths: string[];
	/** The run's shared cache — a path already in it is never read a second time. */
	cache: Map<string, string>;
}

/**
 * Fill the run's shared content cache for a set of paths.
 *
 * Read-through by design: every input kind that carries text draws from one
 * cache, so a file four rules want is opened once for the whole run. That is
 * the whole reason checks declare an input instead of opening files themselves.
 *
 * A path that cannot be read is left out of the cache rather than mapped to an
 * empty string, so a check can tell "there is no text here" from "this file is
 * empty". The returned map is that same rule applied to the asked-for paths
 * alone: a fresh map holding only those with text, so a caller that must not
 * hand the whole cache onward never has to re-derive which reads landed.
 *
 * @param cwd - repo root the paths are relative to
 * @param paths - repo-relative paths to make available
 * @param cache - the run's shared cache, filled in place
 * @returns text for the asked-for paths that have any, in the order asked
 */
export const readIntoCache = async ({ cwd, paths, cache }: Params): Promise<Map<string, string>> => {
	const texts = new Map<string, string>();

	for (const path of paths) {
		if (!cache.has(path)) {
			const text = await readFile(join(cwd, path), 'utf8').catch(() => undefined);

			if (text !== undefined) {
				cache.set(path, text);
			}
		}

		const cached = cache.get(path);

		if (cached !== undefined) {
			texts.set(path, cached);
		}
	}

	return texts;
};
