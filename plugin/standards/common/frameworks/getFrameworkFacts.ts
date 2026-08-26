import type { FrameworkFacts } from '@lightsout/standards-contracts';
import { getFrameworkCarveOuts } from './getFrameworkCarveOuts.ts';
import { getPathCarveOut } from './getPathCarveOut.ts';
import { isFrameworkLoadedFile } from './isFrameworkLoadedFile.ts';

interface Params {
	/** Declared dependency names per package directory, exactly as the engine reads them off the manifests. */
	dependencies: Map<string, string[]>;
}

/**
 * The framework questions this pack answers for the engine's own mirrors of its
 * logic, bound to one repo's declared dependencies.
 *
 * This is the ONLY surface the engine may reach into. The engine mirrors pack
 * logic where it must (`collectFolderModules` mirrors `mapFolderModules`) and
 * asks for the facts rather than copying the table, so the pack a repo actually
 * configured is what answers. It is deliberately one member wide: a second
 * mirror needing another dimension adds a member to `FrameworkFacts` and a line
 * here, never a second entry point.
 *
 * The carve-outs are built once and captured, because the engine calls the
 * returned predicate once per file.
 */
export const getFrameworkFacts = ({ dependencies }: Params): FrameworkFacts => {
	const carveOuts = getFrameworkCarveOuts({ dependencies });

	return {
		isFrameworkLoadedFile: ({ path }) => isFrameworkLoadedFile({ path, carveOut: getPathCarveOut({ carveOuts, path }) }),
	};
};
