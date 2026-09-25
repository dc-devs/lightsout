import { isBarrelFile } from '../paths/isBarrelFile.ts';

interface Params {
	/** Repo-relative path of the barrel whose surface is wanted. */
	barrelPath: string;
	/** Every file each file imports or re-exports from, keyed by the importing file — the import graph's edges, grouped. */
	targetsByFile: Map<string, Set<string>>;
}

/**
 * Every file a barrel exports, directly or through the lower barrels it
 * re-exports from — the files code outside its module may import.
 *
 * A barrel holds only re-export lines, so every edge leaving it is a file it
 * publishes; an edge landing on a lower barrel publishes that barrel's files
 * too, however deep the chain runs.
 */
export const collectPublishedFiles = ({ barrelPath, targetsByFile }: Params): Set<string> => {
	const published = new Set<string>();
	const barrels = [barrelPath];
	const seen = new Set<string>();

	for (let barrel = barrels.pop(); barrel !== undefined; barrel = barrels.pop()) {
		if (seen.has(barrel)) {
			continue;
		}

		seen.add(barrel);

		for (const target of targetsByFile.get(barrel) ?? []) {
			published.add(target);

			if (isBarrelFile({ path: target })) {
				barrels.push(target);
			}
		}
	}

	return published;
};
