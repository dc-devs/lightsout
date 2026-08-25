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
 * Whether the framework, not the author, chose this file's name.
 *
 * Two facts, both stated by the frameworks' own documents: a file router names
 * every file inside its directory (`__root.tsx`, `runs.$runId.tsx`), and a
 * framework that resolves an entry file by convention chose that name too
 * (`main.ts`, `router.tsx`). Either way the export inside was never what named
 * the file, so a rule comparing the two is asking for an edit the framework
 * forbids.
 *
 * This and `isFrameworkLoadedFile` read the same two primitives today and are
 * still separate exports, because they are different questions: one asks who
 * chose the name, the other asks who loads the file. The closed vocabulary
 * exists so that when a framework fact splits them — a router that loads files
 * it does not name, an entry file resolved by content rather than by name —
 * only the question that changed changes.
 */
export const isFrameworkNamedFile = ({ path, carveOut }: Params): boolean => isUnderRouterRoot({ path, carveOut }) || isEntryFile({ path, carveOut });
