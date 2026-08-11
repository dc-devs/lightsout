import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildRawFinding } from '../../../../../common/utils/buildRawFinding.ts';
import { mapFolderModules } from '../../../../../common/utils/mapFolderModules.ts';

const getDepth = ({ path }: { path: string }) => path.split('/').length;
const isInside = ({ file, folder }: { file: string; folder: string }) => file.startsWith(`${folder}/`);

/** One file reaching into one module: everything it deep-imported there, and the barrel it should have gone through. */
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

export const check: StandardsCheckModule = {
	inputKind: 'import-graph',
	/**
	 * An import crosses a boundary when its target sits inside a module the
	 * importer is outside of, and the target is not that module's barrel. With
	 * nested modules the module named is the OUTERMOST one containing the target
	 * but not the importer — the boundary crossed first. Imports into `common/`
	 * are the placement rule's concern rather than a boundary, and a module's own
	 * files importing each other are correct by the doc's second bullet.
	 *
	 * Every internal one file reaches into within the same module is ONE finding:
	 * the fix is a single edit to that file's imports.
	 */
	run: ({ input }): RawStandardsFinding[] => {
		if (input.kind !== 'import-graph') {
			return [];
		}

		const { files, referenceFiles, edges, standardsPackages } = input;
		const targetsByFile = mapTargetsByFile({ edges });
		// Mapped over the whole repo rather than the scope, so a run narrowed to a
		// handful of files still knows where every module's boundary sits.
		const modules = mapFolderModules({
			files: referenceFiles,
			getTargets: ({ barrelPath }) => targetsByFile.get(barrelPath) ?? new Set<string>(),
			standardsPackages,
		});
		const moduleFolders = [...modules.keys()];
		const scope = new Set(files);
		const crossings = new Map<string, Crossing>();

		for (const { from, to } of edges) {
			if (!scope.has(from) || to.split('/').includes('common')) {
				continue;
			}

			const outermost = moduleFolders
				.filter((folder) => isInside({ file: to, folder }) && !isInside({ file: from, folder }))
				.sort((first, second) => getDepth({ path: first }) - getDepth({ path: second }))[0];
			const barrelPath = outermost === undefined ? undefined : modules.get(outermost)?.barrelPath;

			if (outermost === undefined || barrelPath === undefined || to === barrelPath) {
				continue;
			}

			const key = `${from}\0${outermost}`;
			const crossing = crossings.get(key) ?? { from, module: outermost, barrelPath, targets: [] };

			crossings.set(key, { ...crossing, targets: crossing.targets.includes(to) ? crossing.targets : [...crossing.targets, to] });
		}

		return [...crossings.values()].map(({ from, module, barrelPath, targets }) =>
			buildRawFinding({
				rule: 'module-boundary',
				files: [{ path: from }, ...targets.map((path) => ({ path }))],
				detail: `deep-imports ${targets.map((path) => `'${path}'`).join(', ')} — ${targets.length > 1 ? 'internals' : 'an internal'} of module '${module}'; import from its barrel '${barrelPath}' instead`,
				guidance: 'A module’s barrel is its public API; everything else is an internal.',
			}),
		);
	},
};
