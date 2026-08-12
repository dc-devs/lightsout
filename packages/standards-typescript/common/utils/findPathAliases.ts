import type { PathAliases } from '../types/PathAliases.ts';
import { getDirectory } from './getDirectory.ts';
import { readPathAliases } from './readPathAliases.ts';

interface Params {
	/** Repo-relative path of the file whose imports are being resolved. */
	path: string;
	/** The run's file text, which carries every tsconfig.json in scope. */
	contents: Map<string, string>;
}

/**
 * The path aliases in force for one file: those of the nearest `tsconfig.json`
 * at or above it, which is the config TypeScript itself would apply.
 *
 * `undefined` means the question could not be answered — no tsconfig was in
 * scope above this file, or the nearest one inherits its options from a config
 * this run did not read. Every caller must treat that as "I cannot tell",
 * because a monorepo declares its aliases per package: the repo root's config
 * here carries none at all, and reading only that one is what made a whole
 * package's barrels look empty.
 */
export const findPathAliases = ({ path, contents }: Params): PathAliases | undefined => {
	let folder = getDirectory({ path });

	while (true) {
		const tsconfigPath = folder === '.' ? 'tsconfig.json' : `${folder}/tsconfig.json`;
		const text = contents.get(tsconfigPath);

		if (text !== undefined) {
			return readPathAliases({ tsconfigPath, text });
		}

		if (folder === '.') {
			return undefined;
		}

		folder = getDirectory({ path: folder });
	}
};
