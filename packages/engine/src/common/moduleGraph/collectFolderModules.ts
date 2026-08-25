import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type ts from 'typescript';
import { createSpecifierResolver } from '#src/common/moduleGraph/createSpecifierResolver.ts';
import { readBarrelExportTargets } from '#src/common/moduleGraph/readBarrelExportTargets.ts';
import type { FolderModule } from '#src/common/types/FolderModule.ts';

const isBarrel = ({ path }: { path: string }) => /^index\.tsx?$/.test(posix.basename(path));

interface Params {
	cwd: string;
	/** Repo-relative source files in scope (test files already excluded by the caller). */
	files: string[];
	compiler: typeof ts;
	/**
	 * Whether a framework mandates this folder as a module, answered by the
	 * caller. Omitted, nothing is mandated and the omission test decides alone.
	 */
	isMandatedModule?: ({ folder }: { folder: string }) => boolean;
	/**
	 * Whether the package's framework loads this file itself — answered by the
	 * caller from the loaded standards pack's own facts, never from a table held
	 * here. Omitted, every index file is read as a barrel.
	 */
	isFrameworkLoaded?: ({ path }: { path: string }) => boolean;
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
 *
 * A folder a framework mandates as a module is a boundary whatever the
 * omission test says: that test infers a boundary from concealment, which is
 * sound for a folder someone chose and wrong for one a framework requires.
 *
 * The route tree runs the other way: a file router MANDATES an index route, so
 * a router root's `index.tsx` is a route file the framework loads rather than a
 * barrel, and reading it as one turns `src/routes/` into a folder-module whose
 * every route looks like an unexported internal. Those facts arrive as a
 * callback because they are the pack's to state — the engine mirrors the logic
 * and the pack keeps the table.
 *
 * The mirror is deliberate and the two must stay in step, so that the modules
 * the engine picks test subjects from are the same ones the rules judge.
 * Neither copy can import the other: a standards pack ships as a bare
 * directory beside the engine, with no manifest and no `node_modules`, so
 * every value it imports has to resolve inside its own tree, and the engine
 * runs against whatever pack `standards-packs` names rather than the
 * default one. Change one, change the other.
 */
export const collectFolderModules = async ({ cwd, files, compiler, isMandatedModule, isFrameworkLoaded }: Params): Promise<Map<string, FolderModule>> => {
	const resolve = createSpecifierResolver({ files });
	const barrelDirs = new Map<string, string>();

	for (const file of files) {
		const directory = posix.dirname(file);

		if (
			isBarrel({ path: file }) &&
			isFrameworkLoaded?.({ path: file }) !== true &&
			posix.basename(directory) !== 'src' &&
			!directory.split('/').includes('common')
		) {
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

		if (surface.complete && (isMandatedModule?.({ folder }) === true || hasOwnCommon || ownFiles.some((file) => !surface.targets.has(file)))) {
			modules.set(folder, { barrelPath, exportedTargets: surface.targets });
		}
	}

	return modules;
};
