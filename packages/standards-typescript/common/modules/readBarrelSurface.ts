import { ImportTargetKind } from '../constants/ImportTargetKind.ts';
import { isBarrelFile } from '../paths/isBarrelFile.ts';
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

/** The walk itself. `seen` holds the barrels already on this chain, so a pair that re-export each other terminates. */
const readSurface = ({ barrelPath, contents, files, seen }: Params & { seen: Set<string> }): BarrelSurface => {
	if (seen.has(barrelPath)) {
		return { targets: new Set(), complete: true };
	}

	seen.add(barrelPath);

	if (!contents.has(barrelPath)) {
		return { targets: new Set(), complete: false };
	}

	const exports = readBarrelExports({ barrelPath, contents, files });
	const targets = new Set<string>();
	let complete = exports.every((entry) => entry.target.kind !== ImportTargetKind.Unknown);

	for (const entry of exports) {
		if (entry.target.kind !== ImportTargetKind.File) {
			continue;
		}

		targets.add(entry.target.path);

		if (!isBarrelFile({ path: entry.target.path })) {
			continue;
		}

		const nested = readSurface({ barrelPath: entry.target.path, contents, files, seen });

		for (const target of nested.targets) {
			targets.add(target);
		}

		complete = complete && nested.complete;
	}

	return { targets, complete };
};

/**
 * The repo-relative files one barrel makes public, and whether that list is the
 * whole surface.
 *
 * Matched on the resolved target rather than the exported name: an aliased
 * re-export still resolves to the same file, and an `export *` line carries no
 * names at all.
 *
 * A line pointing at another barrel is followed. A name is often published
 * through a chain — `contracts/index.ts` re-exports from
 * `contracts/coverage/index.ts`, which re-exports from
 * `contracts/coverage/CoverageBatchReport.ts` — and stopping at the first hop
 * records the middle barrel as the public thing and the file as private. It is
 * not: a caller importing from the outer barrel reaches it. Reading only one hop
 * made the test-promotion rule report 54 published files as unpublished the day
 * the folders holding them became visible.
 *
 * The completeness flag is the load-bearing half. A specifier that resolves to
 * a published package contributes no target and costs nothing — the barrel is
 * still fully read. A specifier this run could not place, or a nested barrel
 * whose own text is out of scope, leaves the surface incomplete, and every rule
 * that would argue from a file's ABSENCE has to stand down. Without that
 * distinction an unreadable barrel is indistinguishable from an empty one,
 * which is how a rule came to report every test in a package as testing a
 * private internal.
 */
export const readBarrelSurface = ({ barrelPath, contents, files }: Params): BarrelSurface => readSurface({ barrelPath, contents, files, seen: new Set() });
