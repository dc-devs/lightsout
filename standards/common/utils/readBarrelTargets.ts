import { readBarrelExports } from './readBarrelExports.ts';

interface Params {
	/** Repo-relative path of the barrel whose text this is — its folder anchors relative specifiers. */
	barrelPath: string;
	/** The barrel file's contents. */
	text: string;
	/** Every file in scope — the universe relative specifiers resolve against. */
	files: Set<string>;
}

/**
 * The repo-relative files one barrel re-exports.
 *
 * Matched on the resolved target rather than the exported name: an aliased
 * re-export still resolves to the same file, and an `export *` line carries no
 * names at all. A specifier that resolves to nothing in scope — an external
 * package, a missing file — simply contributes no target, which is why the
 * barrel-omission test degrades toward "hides nothing" rather than toward a
 * boundary nobody declared.
 *
 * @param barrelPath - repo-relative path of the barrel
 * @param text - the barrel file's contents
 * @param files - every file in scope
 */
export const readBarrelTargets = ({ barrelPath, text, files }: Params): Set<string> =>
	new Set(
		readBarrelExports({ barrelPath, text, files })
			.map(({ target }) => target)
			.filter((target): target is string => target !== undefined),
	);
