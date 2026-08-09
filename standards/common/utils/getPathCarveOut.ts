import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';

/**
 * A path under no package at all, and the doc's plain defaults for one whose
 * package declares no framework these rules know.
 */
const noCarveOut: FrameworkCarveOut = { directory: '.', exemptFolderNames: [], kebabCase: false, routerRoots: [] };

interface Params {
	/** Every package's carve-outs, longest directory first — the order `getFrameworkCarveOuts` returns them in. */
	carveOuts: FrameworkCarveOut[];
	/** A repo-relative file or folder path. */
	path: string;
}

/**
 * The carve-out that governs one path — the nearest package's, since the list
 * is ordered longest directory first and the repo root matches everything.
 *
 * @param carveOuts - every package's carve-outs, longest directory first
 * @param path - the repo-relative path being judged
 */
export const getPathCarveOut = ({ carveOuts, path }: Params): FrameworkCarveOut =>
	carveOuts.find(({ directory }) => directory === '.' || path.startsWith(`${directory}/`)) ?? noCarveOut;
