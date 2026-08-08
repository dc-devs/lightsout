import type ts from 'typescript';
import { StandardsRule, StandardsSeverity, type StandardsFinding } from '@/contracts';
import { collectImportEdges } from '@/common/utils/collectImportEdges';
import { mapFolderModules } from '@/scan/mapFolderModules';

const depth = (path: string) => path.split('/').length;
const inside = ({ file, folder }: { file: string; folder: string }) => file.startsWith(`${folder}/`);

interface Params {
	cwd: string;
	/** Repo-relative source files, TESTS INCLUDED — amended boundary rule 4 puts a test's deep import in scope. */
	files: string[];
	compiler: typeof ts;
}

/**
 * Module-boundary detector: an import edge violates the boundary when its
 * resolved target sits inside a `module`-status folder M, the importer sits
 * outside M, and the target is not M's barrel — a deep import that should
 * have gone through the module's `index.ts`. With nested modules M is the
 * OUTERMOST module folder containing the target but not the importer (the
 * boundary crossed first). Imports into `common/` subtrees are the placement
 * detector's concern, not a boundary; domain folders, same-module imports and
 * package-root barrels are never boundaries. Runs only when TypeScript
 * resolves (import resolution required); runScan reports the honest skip
 * otherwise.
 */
export const scanModuleBoundaries = async ({ cwd, files, compiler }: Params): Promise<StandardsFinding[]> => {
	const modules = await mapFolderModules({ cwd, files });
	const edges = await collectImportEdges({ cwd, files, compiler });
	const moduleFolders = [...modules.entries()].filter(([, entry]) => entry.status === 'module').map(([folder]) => folder);

	const findings: StandardsFinding[] = [];
	const seen = new Set<string>();

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
		const key = `${from}\0${to}`;

		if (to === barrelPath || seen.has(key)) {
			continue;
		}

		seen.add(key);
		findings.push({
			rule: StandardsRule.ModuleBoundary,
			severity: StandardsSeverity.Finding,
			siteKey: `boundary:${from}`,
			files: [{ path: from }, { path: to }],
			detail: `deep-imports '${to}' — an internal of module '${outermost}'; import from its barrel '${barrelPath}' instead`,
			guidance: 'A module’s barrel is its public API; everything else is an internal.',
		});
	}

	return findings;
};
