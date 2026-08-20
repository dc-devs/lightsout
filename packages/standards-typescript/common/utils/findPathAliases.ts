import type { PathAliases } from '../types/PathAliases.ts';
import { getDirectory } from './getDirectory.ts';
import { readPackageImports } from './readPackageImports.ts';
import { readPathAliases } from './readPathAliases.ts';

interface Params {
	/** Repo-relative path of the file whose imports are being resolved. */
	path: string;
	/** The run's file text, which carries every package.json and tsconfig.json in scope. */
	contents: Map<string, string>;
}

/**
 * The path aliases in force for one file: those declared by the nearest
 * package at or above it, from either place a package may declare them — its
 * `package.json` → `imports`, which Node, TypeScript, esbuild, Vite and Jest
 * all read, or its `tsconfig.json` → `compilerOptions.paths`.
 *
 * The manifest is asked first. A package that declares `imports` has stated its
 * alias mechanism, and the tsconfig beside it may legitimately declare no
 * `paths` at all — which `readPathAliases` would otherwise answer as the
 * confident "this package has no aliases" that makes every aliased import read
 * as a published package.
 *
 * `undefined` means the question could not be answered — no manifest and no
 * tsconfig in scope above this file declared anything, or the ones that did
 * inherit their options from a config this run did not read. Every caller must
 * treat that as "I cannot tell", because a monorepo declares its aliases per
 * package: the repo root's config here carries none at all, and reading only
 * that one is what made a whole package's barrels look empty.
 */
export const findPathAliases = ({ path, contents }: Params): PathAliases | undefined => {
	let folder = getDirectory({ path });

	while (true) {
		const manifestPath = folder === '.' ? 'package.json' : `${folder}/package.json`;
		const manifestText = contents.get(manifestPath);
		const declared = manifestText === undefined ? undefined : readPackageImports({ manifestPath, text: manifestText });

		if (declared !== undefined) {
			return declared;
		}

		const tsconfigPath = folder === '.' ? 'tsconfig.json' : `${folder}/tsconfig.json`;
		const tsconfigText = contents.get(tsconfigPath);
		const configured = tsconfigText === undefined ? undefined : readPathAliases({ tsconfigPath, text: tsconfigText });

		if (configured !== undefined) {
			return configured;
		}

		if (folder === '.') {
			return undefined;
		}

		folder = getDirectory({ path: folder });
	}
};
