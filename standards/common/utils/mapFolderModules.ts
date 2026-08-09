import type { FolderModule } from '../types/FolderModule.ts';
import { getBaseName } from './getBaseName.ts';
import { getDirectory } from './getDirectory.ts';
import { isTestFile } from './isTestFile.ts';

const isBarrel = ({ path }: { path: string }) => /^index\.tsx?$/.test(getBaseName({ path }));

interface Params {
	/** Every file in scope — barrels are found here and measured against it. */
	files: string[];
	/**
	 * The repo-relative files one barrel re-exports. Supplied by the caller
	 * because only it knows what its input carries: a rule handed file text reads
	 * the barrel's own re-export lines, a rule handed the import graph reads the
	 * edges leaving the barrel. Either answers the same question, and neither
	 * opens a file.
	 */
	getTargets: ({ barrelPath }: { barrelPath: string }) => Set<string>;
}

/**
 * Every folder whose barrel marks a boundary, by the standards' own
 * barrel-omission test: a barrel that hides something is a module, and a barrel
 * that re-exports every file in its folder hides nothing, so that folder is a
 * domain folder and never appears here.
 *
 * Package and repo `src` roots are excluded — a root barrel is a package's API,
 * not an internal module — and so is anything under a `common/` segment, whose
 * contents are internal by definition. Files inside a nested module are removed
 * before the omission test, so a folder whose only descendants live in nested
 * modules omits nothing and is not itself a boundary.
 */
export const mapFolderModules = ({ files, getTargets }: Params): Map<string, FolderModule> => {
	const barrelDirs = new Map<string, string>();

	for (const file of files) {
		const directory = getDirectory({ path: file });

		if (isBarrel({ path: file }) && getBaseName({ path: directory }) !== 'src' && !directory.split('/').includes('common')) {
			barrelDirs.set(directory, file);
		}
	}

	const nestedModuleDirs = [...barrelDirs.keys()];
	const modules = new Map<string, FolderModule>();

	for (const [folder, barrelPath] of barrelDirs) {
		const exportedTargets = getTargets({ barrelPath });
		const prefix = `${folder}/`;
		const hasOwnCommon = files.some((file) => file.startsWith(`${folder}/common/`));
		const ownFiles = files.filter(
			(file) =>
				file.startsWith(prefix) &&
				!isBarrel({ path: file }) &&
				!isTestFile({ path: file }) &&
				/\.tsx?$/.test(file) &&
				!nestedModuleDirs.some((other) => other !== folder && other.startsWith(prefix) && file.startsWith(`${other}/`)),
		);

		if (hasOwnCommon || ownFiles.some((file) => !exportedTargets.has(file))) {
			modules.set(folder, { barrelPath, exportedTargets });
		}
	}

	return modules;
};
