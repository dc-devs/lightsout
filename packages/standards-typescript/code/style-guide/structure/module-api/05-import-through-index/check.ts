import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildRawFinding } from '../../../../../common/findings/buildRawFinding.ts';
import { getFrameworkCarveOuts } from '../../../../../common/frameworks/getFrameworkCarveOuts.ts';
import { getPathCarveOut } from '../../../../../common/frameworks/getPathCarveOut.ts';
import { isFrameworkLoadedFile } from '../../../../../common/frameworks/isFrameworkLoadedFile.ts';
import { getTestSubject } from '../../../../../common/paths/getTestSubject.ts';
import { isBarrelFile } from '../../../../../common/paths/isBarrelFile.ts';
import { isOutsideEveryPackage } from '../../../../../common/paths/isOutsideEveryPackage.ts';

/** The workspace package a file belongs to: the longest package directory holding it, `.` for the repo root. */
const getOwningPackage = ({ path, packageDirectories }: { path: string; packageDirectories: string[] }) =>
	packageDirectories.filter((directory) => directory === '.' || path.startsWith(`${directory}/`)).sort((first, second) => second.length - first.length)[0];

export const check: StandardsCheckModule = {
	inputKind: 'import-graph',
	/**
	 * Every import names the file that declares what it imports, so a file
	 * naming an index file of its own package is reported — every index file it
	 * names in one finding, since the fix is a single edit to its imports.
	 *
	 * An index file may still re-export from another (a package entry listing
	 * what a lower one lists), an index file's own test may import it, a route
	 * the framework loads is no index file at all, and another package's entry
	 * is that package's public API.
	 *
	 * Where a package keeps its folders is the package's own business, so an
	 * importer belonging to no package is skipped — and a repo whose manifests
	 * declare no workspace package is itself the package, so everything in it is
	 * judged.
	 */
	run: ({ input }): RawStandardsFinding[] => {
		if (input.kind !== 'import-graph') {
			return [];
		}

		const { files, referenceFiles, edges, dependencies } = input;
		const carveOuts = getFrameworkCarveOuts({ dependencies });
		const packageDirectories = [...dependencies.keys()];
		const referenceSet = new Set(referenceFiles);
		const scope = new Set(files);
		const barrelsByImporter = new Map<string, string[]>();

		for (const { from, to } of edges) {
			if (
				scope.has(from) &&
				!isOutsideEveryPackage({ path: from, packageDirectories }) &&
				isBarrelFile({ path: to }) &&
				!isBarrelFile({ path: from }) &&
				!isFrameworkLoadedFile({ path: to, carveOut: getPathCarveOut({ carveOuts, path: to }) }) &&
				getTestSubject({ test: from, files: referenceSet }) !== to &&
				getOwningPackage({ path: from, packageDirectories }) === getOwningPackage({ path: to, packageDirectories })
			) {
				const barrels = barrelsByImporter.get(from) ?? [];

				barrelsByImporter.set(from, barrels.includes(to) ? barrels : [...barrels, to]);
			}
		}

		return [...barrelsByImporter].map(([from, barrels]) =>
			buildRawFinding({
				rule: 'import-through-index',
				files: [{ path: from }, ...barrels.map((path) => ({ path }))],
				detail: `imports through ${barrels.map((path) => `'${path}'`).join(', ')} — import each name from the file that declares it instead`,
				guidance: 'An index file lists what a package makes public; nothing inside the package imports through it.',
			}),
		);
	},
};
