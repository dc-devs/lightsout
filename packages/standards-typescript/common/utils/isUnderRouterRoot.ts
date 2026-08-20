import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { getSourceRoot } from './getSourceRoot.ts';

interface Params {
	/** A repo-relative file or folder path. */
	path: string;
	/** The carve-out of the package that governs this path. */
	carveOut: FrameworkCarveOut;
}

/**
 * Whether a path sits inside a directory the package's router owns — the one
 * place a framework, not these documents, decides what files and folders are
 * called.
 *
 * Matched only DIRECTLY under the package's `src/`: at arbitrary depth an
 * ordinary domain folder called `routes` would exempt its whole subtree from
 * rules that have every reason to judge it.
 *
 * @param path - the repo-relative file or folder being judged
 * @param carveOut - the governing package's carve-out, from `getPathCarveOut`
 */
export const isUnderRouterRoot = ({ path, carveOut }: Params): boolean => {
	const sourceRoot = getSourceRoot({ carveOut });

	return path.startsWith(sourceRoot) && carveOut.routerRoots.includes(path.slice(sourceRoot.length).replace(/\/.*$/, ''));
};
