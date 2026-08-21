import { getBaseName } from '../paths/getBaseName.ts';
import { getDirectory } from '../paths/getDirectory.ts';
import { isBarrelFile } from '../paths/isBarrelFile.ts';
import { isTestFile } from '../paths/isTestFile.ts';
import type { BarrelSurface } from '../types/BarrelSurface.ts';
import type { FolderModule } from '../types/FolderModule.ts';

interface Params {
	/** Every file in scope — barrels are found here and measured against it. */
	files: string[];
	/**
	 * What one barrel makes public, and whether all of it could be read. Supplied
	 * by the caller because only it knows what its input carries: a rule handed
	 * file text reads the barrel's own re-export lines, a rule handed the import
	 * graph reads the edges leaving the barrel. Either answers the same question,
	 * and neither opens a file.
	 */
	getSurface: ({ barrelPath }: { barrelPath: string }) => BarrelSurface;
	/** Repo-relative standards package roots, so a package's `tests/` document set is not read as test code. */
	standardsPackages: string[];
	/**
	 * Whether a framework mandates this folder as a module, answered by the
	 * caller for the same reason `getSurface` is: only it knows what its input
	 * carries, and the dependency facts a mandate turns on reach different rules
	 * by different routes. Omitted, nothing is mandated and the omission test
	 * decides alone.
	 */
	isMandatedModule?: ({ folder }: { folder: string }) => boolean;
}

/**
 * Every folder whose barrel marks a boundary, by the standards' own
 * barrel-omission test: a barrel that hides something is a module, and a barrel
 * that re-exports every file in its folder hides nothing, so that folder is a
 * domain folder and never appears here.
 *
 * A folder the package's framework mandates as a module is a boundary whatever
 * the omission test says. The test infers a boundary from concealment, which is
 * sound for a folder someone chose and wrong for one a framework requires: a
 * screen folder holds a single component the day it is made and grows its own
 * `components/` and `hooks/` as the screen does, and it is the same boundary
 * throughout.
 *
 * Package and repo `src` roots are excluded — a root barrel is a package's API,
 * not an internal module — and so is anything under a `common/` segment, whose
 * contents are internal by definition. Files inside a nested module are removed
 * before the omission test, so a folder whose only descendants live in nested
 * modules omits nothing and is not itself a boundary.
 *
 * A barrel whose surface could not be fully read is left out entirely, however
 * it looks. Every rule downstream argues from `exportedTargets` — that a file
 * is not in it, that a published name is unused — and a partial set makes all
 * of those arguments wrong in the direction that invents findings. Silence for
 * one folder is the cheap failure; a package-wide flood of them is not.
 *
 * The engine keeps a mirror of this, `collectFolderModules`, which answers the
 * same question over disk and the consumer's compiler instead of supplied file
 * text — so the modules it picks test subjects from are the ones these rules
 * judge. The copy cannot be collapsed: this package ships as a bare directory
 * with no manifest and no `node_modules`, so every value it imports has to
 * resolve inside its own tree. Change one, change the other.
 */
export const mapFolderModules = ({ files, getSurface, standardsPackages, isMandatedModule }: Params): Map<string, FolderModule> => {
	const barrelDirs = new Map<string, string>();

	for (const file of files) {
		const directory = getDirectory({ path: file });

		if (isBarrelFile({ path: file }) && getBaseName({ path: directory }) !== 'src' && !directory.split('/').includes('common')) {
			barrelDirs.set(directory, file);
		}
	}

	const nestedModuleDirs = [...barrelDirs.keys()];
	const modules = new Map<string, FolderModule>();

	for (const [folder, barrelPath] of barrelDirs) {
		const { targets: exportedTargets, complete } = getSurface({ barrelPath });
		const prefix = `${folder}/`;
		const hasOwnCommon = files.some((file) => file.startsWith(`${folder}/common/`));
		const ownFiles = files.filter(
			(file) =>
				file.startsWith(prefix) &&
				!isBarrelFile({ path: file }) &&
				!isTestFile({ path: file, standardsPackages }) &&
				/\.tsx?$/.test(file) &&
				!nestedModuleDirs.some((other) => other !== folder && other.startsWith(prefix) && file.startsWith(`${other}/`)),
		);

		if (complete && (isMandatedModule?.({ folder }) === true || hasOwnCommon || ownFiles.some((file) => !exportedTargets.has(file)))) {
			modules.set(folder, { barrelPath, exportedTargets });
		}
	}

	return modules;
};
