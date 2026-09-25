import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildRawFinding } from '../../../../../common/findings/buildRawFinding.ts';
import { getFrameworkCarveOuts } from '../../../../../common/frameworks/getFrameworkCarveOuts.ts';
import { getPathCarveOut } from '../../../../../common/frameworks/getPathCarveOut.ts';
import { isFrameworkLoadedFile } from '../../../../../common/frameworks/isFrameworkLoadedFile.ts';
import { isMandatedModuleFolder } from '../../../../../common/frameworks/isMandatedModuleFolder.ts';
import { mapFolderModules } from '../../../../../common/modules/mapFolderModules.ts';
import { getTestSubject } from '../../../../../common/paths/getTestSubject.ts';
import { isBarrelFile } from '../../../../../common/paths/isBarrelFile.ts';
import { isOutsideEveryPackage } from '../../../../../common/paths/isOutsideEveryPackage.ts';

const getDepth = ({ path }: { path: string }) => path.split('/').length;
const isInside = ({ file, folder }: { file: string; folder: string }) => file.startsWith(`${folder}/`);

/** One file importing through index files: every index file it names. */
interface ThroughIndex {
	from: string;
	barrels: string[];
}

/** One file reaching into one module: every file it imported there that the module's barrel does not export. */
interface Crossing {
	from: string;
	module: string;
	barrelPath: string;
	targets: string[];
}

/** Every file a barrel points at, keyed by the barrel — the import graph's answer to "what does this barrel make public?". */
const mapTargetsByFile = ({ edges }: { edges: Array<{ from: string; to: string }> }) => {
	const targets = new Map<string, Set<string>>();

	for (const { from, to } of edges) {
		targets.set(from, (targets.get(from) ?? new Set<string>()).add(to));
	}

	return targets;
};

/**
 * Every file a barrel exports, directly or through the lower barrels it
 * re-exports from — the files code outside the module may import.
 */
const collectPublishedFiles = ({ barrelPath, targetsByFile }: { barrelPath: string; targetsByFile: Map<string, Set<string>> }) => {
	const published = new Set<string>();
	const barrels = [barrelPath];
	const seen = new Set<string>();

	for (let barrel = barrels.pop(); barrel !== undefined; barrel = barrels.pop()) {
		if (seen.has(barrel)) {
			continue;
		}

		seen.add(barrel);

		for (const target of targetsByFile.get(barrel) ?? []) {
			published.add(target);

			if (isBarrelFile({ path: target })) {
				barrels.push(target);
			}
		}
	}

	return published;
};

/** The workspace package a file belongs to: the longest package directory holding it, `.` for the repo root. */
const getOwningPackage = ({ path, packageDirectories }: { path: string; packageDirectories: string[] }) =>
	packageDirectories.filter((directory) => directory === '.' || path.startsWith(`${directory}/`)).sort((first, second) => second.length - first.length)[0];

export const check: StandardsCheckModule = {
	inputKind: 'import-graph',
	/**
	 * Two verdicts, both about where an import points.
	 *
	 * An import through an index file: every name is imported from the file that
	 * declares it, so a file naming a barrel of its own package is reported. A
	 * barrel may still re-export from a lower barrel, a barrel's own test may
	 * import it, a route the framework loads is no barrel, and another package's
	 * entry is that package's public API.
	 *
	 * An import across a boundary: the target sits inside a module the importer
	 * is outside of, and that module's barrel does not export it — directly or
	 * through a lower barrel. With nested modules the module named is the
	 * OUTERMOST one containing the target but not the importer — the boundary
	 * crossed first. Imports into `common/` are the placement rule's concern
	 * rather than a boundary, and a module's own files — its tests included —
	 * importing each other are correct.
	 *
	 * Every file one importer reaches into within the same module is ONE finding,
	 * and so is every barrel one file imports through: each fix is a single edit
	 * to that file's imports.
	 *
	 * Module boundaries are a package's own architecture, so an importer
	 * belonging to no package is skipped — and a repo whose manifests declare no
	 * workspace package is itself the package, so everything in it is judged.
	 */
	run: ({ input }): RawStandardsFinding[] => {
		if (input.kind !== 'import-graph') {
			return [];
		}

		const { files, referenceFiles, edges, standardsPacks, dependencies } = input;
		const carveOuts = getFrameworkCarveOuts({ dependencies });
		const packageDirectories = [...dependencies.keys()];
		const targetsByFile = mapTargetsByFile({ edges });
		const isFrameworkLoaded = ({ path }: { path: string }) => isFrameworkLoadedFile({ path, carveOut: getPathCarveOut({ carveOuts, path }) });
		// Mapped over the whole repo rather than the scope, so a run narrowed to a
		// handful of files still knows where every module's boundary sits.
		const modules = mapFolderModules({
			files: referenceFiles,
			// Always complete: the graph resolves an aliased specifier by unique path
			// suffix before an edge is ever recorded, so a barrel with no edge leaving
			// it re-exports nothing — as opposed to the file-text readers, which can
			// be handed a barrel whose aliases they were never given.
			getSurface: ({ barrelPath }) => ({ targets: targetsByFile.get(barrelPath) ?? new Set<string>(), complete: true }),
			standardsPacks,
			// A framework-mandated folder is a boundary on the day it holds one file,
			// which the omission test alone reads as a convenience.
			isMandatedModule: ({ folder }) => isMandatedModuleFolder({ folder, carveOut: getPathCarveOut({ carveOuts, path: folder }) }),
			// A router root's `index.tsx` is a route, so it marks no boundary and
			// its siblings are not somebody's unexported internals.
			isFrameworkLoaded,
		});
		const moduleFolders = [...modules.keys()];
		const referenceSet = new Set(referenceFiles);
		const publishedByModule = new Map<string, Set<string>>();
		const scope = new Set(files);
		const throughIndex = new Map<string, ThroughIndex>();
		const crossings = new Map<string, Crossing>();

		for (const { from, to } of edges) {
			if (!scope.has(from) || isOutsideEveryPackage({ path: from, packageDirectories })) {
				continue;
			}

			if (
				isBarrelFile({ path: to }) &&
				!isBarrelFile({ path: from }) &&
				!isFrameworkLoaded({ path: to }) &&
				getTestSubject({ test: from, files: referenceSet }) !== to &&
				getOwningPackage({ path: from, packageDirectories }) === getOwningPackage({ path: to, packageDirectories })
			) {
				const entry = throughIndex.get(from) ?? { from, barrels: [] };

				throughIndex.set(from, { from, barrels: entry.barrels.includes(to) ? entry.barrels : [...entry.barrels, to] });
				continue;
			}

			if (to.split('/').includes('common')) {
				continue;
			}

			const outermost = moduleFolders
				.filter((folder) => isInside({ file: to, folder }) && !isInside({ file: from, folder }))
				.sort((first, second) => getDepth({ path: first }) - getDepth({ path: second }))[0];
			const barrelPath = outermost === undefined ? undefined : modules.get(outermost)?.barrelPath;

			if (outermost === undefined || barrelPath === undefined || to === barrelPath) {
				continue;
			}

			const published = publishedByModule.get(outermost) ?? collectPublishedFiles({ barrelPath, targetsByFile });

			publishedByModule.set(outermost, published);

			if (published.has(to)) {
				continue;
			}

			const key = `${from}\0${outermost}`;
			const crossing = crossings.get(key) ?? { from, module: outermost, barrelPath, targets: [] };

			crossings.set(key, { ...crossing, targets: crossing.targets.includes(to) ? crossing.targets : [...crossing.targets, to] });
		}

		return [
			...[...throughIndex.values()].map(({ from, barrels }) =>
				buildRawFinding({
					rule: 'module-boundary',
					files: [{ path: from }, ...barrels.map((path) => ({ path }))],
					detail: `imports through ${barrels.map((path) => `'${path}'`).join(', ')} — import each name from the file that declares it instead`,
					guidance: 'An index file lists what its module makes public; nothing imports through it.',
				}),
			),
			...[...crossings.values()].map(({ from, module, barrelPath, targets }) =>
				buildRawFinding({
					rule: 'module-boundary',
					files: [{ path: from }, ...targets.map((path) => ({ path }))],
					detail: `imports ${targets.map((path) => `'${path}'`).join(', ')} — ${targets.length > 1 ? 'internals' : 'an internal'} of module '${module}' that its barrel '${barrelPath}' does not export`,
					guidance: 'Outside a module, import only the files its index file exports.',
				}),
			),
		];
	},
};
