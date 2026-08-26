import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { isEntryFile } from './isEntryFile.ts';
import { isUnderRouterRoot } from './isUnderRouterRoot.ts';

interface Params {
	/** A repo-relative file path. */
	path: string;
	/** The carve-out of the package that governs this path. */
	carveOut: FrameworkCarveOut;
}

/**
 * Whether the framework reaches this file itself, without any source file
 * importing it.
 *
 * A file router loads its route files and a framework resolves its
 * convention-named entry files, so nothing in the source tree imports either.
 * Three rules turn on that one fact: an unconsumed-export scan must count such a
 * file as a consumer, an index file under a router root is a route rather than a
 * barrel, and a directory the router owns is not the author's folder to
 * consolidate.
 *
 * Distinct from `isFrameworkNamedFile`, which asks who chose the name; see that
 * file for why the two stay apart while their bodies agree.
 */
export const isFrameworkLoadedFile = ({ path, carveOut }: Params): boolean => isUnderRouterRoot({ path, carveOut }) || isEntryFile({ path, carveOut });
