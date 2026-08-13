import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type ts from 'typescript';
import type { FolderModule } from '@/common/types/FolderModule';
import { createSpecifierResolver } from '@/common/utils/createSpecifierResolver';
import { readBarrelExportTargets } from '@/common/utils/readBarrelExportTargets';

const isBarrel = ({ path }: { path: string }) => /^index\.tsx?$/.test(posix.basename(path));

interface Params {
	cwd: string;
	/** Repo-relative source files in scope (test files already excluded by the caller). */
	files: string[];
	compiler: typeof ts;
}

/**
 * Every folder whose barrel marks a boundary, by the standards' own
 * barrel-omission test — the engine-side mirror of the standards package's
 * `mapFolderModules`, working over disk and the consumer's compiler instead
 * of supplied file text.
 *
 * `src` roots and anything under a `common/` segment are excluded; files
 * inside nested modules are removed before the omission test; and a barrel
 * whose surface could not be fully read is left out entirely — silence, not
 * invented boundaries.
 */
export const collectFolderModules = async ({ cwd, files, compiler }: Params): Promise<Map<string, FolderModule>> => {
	const resolve = createSpecifierResolver({ files });
	const barrelDirs = new Map<string, string>();

	for (const file of files) {
		const directory = posix.dirname(file);

		if (isBarrel({ path: file }) && posix.basename(directory) !== 'src' && !directory.split('/').includes('common')) {
			barrelDirs.set(directory, file);
		}
	}

	const nestedModuleDirs = [...barrelDirs.keys()];
	const modules = new Map<string, FolderModule>();

	for (const [folder, barrelPath] of barrelDirs) {
		const content = await readFile(join(cwd, barrelPath), 'utf8').catch(() => undefined);
		const surface =
			content === undefined ? { targets: new Set<string>(), complete: false } : readBarrelExportTargets({ path: barrelPath, content, compiler, resolve });
		const prefix = `${folder}/`;
		const hasOwnCommon = files.some((file) => file.startsWith(`${folder}/common/`));
		const ownFiles = files.filter(
			(file) =>
				file.startsWith(prefix) &&
				!isBarrel({ path: file }) &&
				/\.tsx?$/.test(file) &&
				!nestedModuleDirs.some((other) => other !== folder && other.startsWith(prefix) && file.startsWith(`${other}/`)),
		);

		if (surface.complete && (hasOwnCommon || ownFiles.some((file) => !surface.targets.has(file)))) {
			modules.set(folder, { barrelPath, exportedTargets: surface.targets });
		}
	}

	return modules;
};
