import { StandardsRule } from '@/contracts';
import { collectImportEdges } from '@/common/utils/collectImportEdges';
import { mapFolderModules } from '@/standardsCheck/mapFolderModules';
import type { StandardsPass } from '@/standardsCheck/common/types/StandardsPass';
import { buildFinding } from '@/standardsCheck/common/utils/buildFinding';

const depth = (path: string) => path.split('/').length;
const inside = ({ file, folder }: { file: string; folder: string }) => file.startsWith(`${folder}/`);

/**
 * Module-boundary check: an import edge violates the boundary when its
 * resolved target sits inside a `module`-status folder M, the importer sits
 * outside M, and the target is not M's barrel — a deep import that should
 * have gone through the module's `index.ts`. With nested modules M is the
 * OUTERMOST module folder containing the target but not the importer (the
 * boundary crossed first). Imports into `common/` subtrees are the placement
 * check's concern, not a boundary; domain folders, same-module imports and
 * package-root barrels are never boundaries.
 *
 * Every internal one file reaches into within the same module is ONE finding —
 * the fix is a single edit to that file's imports. Runs only when TypeScript
 * resolves (import resolution required); runStandardsCheck reports the honest
 * skip otherwise.
 */
export const checkModuleBoundaries: StandardsPass = async ({ cwd, files, compiler }) => {
	if (compiler === undefined) {
		return [];
	}

	const modules = await mapFolderModules({ cwd, files });
	const edges = await collectImportEdges({ cwd, files, compiler });
	const moduleFolders = [...modules.entries()].filter(([, entry]) => entry.status === 'module').map(([folder]) => folder);

	const crossings = new Map<string, { from: string; module: string; barrelPath?: string; targets: string[] }>();

	for (const { from, to } of edges) {
		if (to.split('/').includes('common')) {
			continue;
		}

		const crossed = moduleFolders.filter((folder) => inside({ file: to, folder }) && !inside({ file: from, folder }));
		const outermost = crossed.sort((first, second) => depth(first) - depth(second))[0];

		if (outermost === undefined) {
			continue;
		}

		const barrelPath = modules.get(outermost)?.barrelPath;

		if (to === barrelPath) {
			continue;
		}

		const key = `${from}\0${outermost}`;
		const crossing = crossings.get(key) ?? { from, module: outermost, barrelPath, targets: [] };

		crossings.set(key, { ...crossing, targets: crossing.targets.includes(to) ? crossing.targets : [...crossing.targets, to] });
	}

	return [...crossings.values()].map(({ from, module, barrelPath, targets }) => {
		const sites = [{ path: from }, ...targets.map((path) => ({ path }))];

		return buildFinding({
			rule: StandardsRule.ModuleBoundary,
			files: sites,
			detail: `deep-imports ${targets.map((path) => `'${path}'`).join(', ')} — ${targets.length > 1 ? 'internals' : 'an internal'} of module '${module}'; import from its barrel '${barrelPath}' instead`,
			guidance: 'A module’s barrel is its public API; everything else is an internal.',
		});
	});
};
