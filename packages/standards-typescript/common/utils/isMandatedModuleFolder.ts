import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { getSourceRoot } from './getSourceRoot.ts';

interface Params {
	/** A repo-relative folder path. */
	folder: string;
	/** The carve-out of the package that governs this path. */
	carveOut: FrameworkCarveOut;
}

/** Each pattern segment matches a path segment; a `*` segment matches any one name, so a pattern can never swallow a subtree. */
const matches = ({ pattern, segments }: { pattern: string; segments: string[] }): boolean => {
	const parts = pattern.split('/');

	return parts.length === segments.length && parts.every((part, index) => part === '*' || part === segments[index]);
};

/**
 * Whether a folder is one the package's framework requires to be a module.
 *
 * The barrel-omission test infers a boundary from concealment: a barrel that
 * re-exports everything hides nothing, so its folder is a convenience rather
 * than a module. That inference is sound where the folder was someone's choice
 * and wrong where a framework mandated it — a TanStack Start screen holds one
 * component on the day it is created and grows its own `components/` and
 * `hooks/` later, and it is a boundary throughout.
 *
 * Matched inside the governing package's `src/` only, so a repo's fixture trees
 * and test helpers cannot pick up a mandate meant for source.
 *
 * @param folder - the repo-relative folder being judged
 * @param carveOut - the governing package's carve-out, from `getPathCarveOut`
 */
export const isMandatedModuleFolder = ({ folder, carveOut }: Params): boolean => {
	const sourceRoot = getSourceRoot({ carveOut });

	if (!folder.startsWith(sourceRoot)) {
		return false;
	}

	const segments = folder.slice(sourceRoot.length).split('/');

	return carveOut.moduleFolders.some((pattern) => matches({ pattern, segments }));
};
