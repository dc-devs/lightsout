import type { BarrelSurface } from '../types/BarrelSurface.ts';
import { readBarrelExports } from './readBarrelExports.ts';

interface Params {
	/** Repo-relative path of the barrel to read. */
	barrelPath: string;
	/** The run's file text, holding the barrel and every tsconfig.json in scope. */
	contents: Map<string, string>;
	/** Every file in scope — the universe specifiers resolve against. */
	files: Set<string>;
}

/**
 * The repo-relative files one barrel re-exports, and whether that list is the
 * whole surface.
 *
 * Matched on the resolved target rather than the exported name: an aliased
 * re-export still resolves to the same file, and an `export *` line carries no
 * names at all.
 *
 * The completeness flag is the load-bearing half. A specifier that resolves to
 * a published package contributes no target and costs nothing — the barrel is
 * still fully read. A specifier this run could not place leaves the surface
 * incomplete, and every rule that would argue from a file's ABSENCE has to
 * stand down. Without that distinction an unreadable barrel is indistinguishable
 * from an empty one, which is how a rule came to report every test in a package
 * as testing a private internal.
 */
export const readBarrelSurface = ({ barrelPath, contents, files }: Params): BarrelSurface => {
	const exports = readBarrelExports({ barrelPath, contents, files });

	return {
		targets: new Set(exports.flatMap((entry) => (entry.target.kind === 'file' ? [entry.target.path] : []))),
		complete: exports.every((entry) => entry.target.kind !== 'unknown'),
	};
};
