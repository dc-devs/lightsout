import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { getSourceRoot } from './getSourceRoot.ts';

interface Params {
	/** A repo-relative file path. */
	path: string;
	/** The carve-out of the package that governs this path. */
	carveOut: FrameworkCarveOut;
}

/**
 * Whether a path is one the package's framework resolves by convention —
 * TanStack Start's `router.tsx`, NestJS's `main.ts` and their siblings.
 *
 * A framework that resolves a file by convention names it itself and reaches it
 * without an import. Both facts are invisible to a check reading exports or
 * filenames, which is why `src/router.tsx` exporting `getRouter` reads as a
 * dead export and as a filename mismatch when nothing tells the check the
 * framework owns that name.
 *
 * The remainder after the source root is compared whole rather than by
 * basename, and matched inside the governing package's `src/` only: a monorepo's
 * other packages, a repo's own fixture trees, and an author's
 * `src/features/runs/router.tsx` all keep their ordinary judgement.
 *
 * Landed deliberately ahead of the checks that read it. `entryFiles` and this
 * predicate are the two halves of one fact, and the rules that consult it — the
 * unconsumed-export scan, the filename-match rule — take it in a later change,
 * so no check has to carry half the shape in the meantime.
 */
export const isEntryFile = ({ path, carveOut }: Params): boolean => {
	const sourceRoot = getSourceRoot({ carveOut });

	return path.startsWith(sourceRoot) && carveOut.entryFiles.includes(path.slice(sourceRoot.length));
};
