import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { isTestFile } from '@/common/utils/isTestFile';
import { readBarrelExports } from '@/scan/readBarrelExports';

const isBarrel = (path: string) => /^index\.tsx?$/.test(basename(path));
const isRootBarrelDir = (dir: string) => basename(dir) === 'src';
const underCommon = (path: string) => path.split('/').includes('common');

interface Params {
	cwd: string;
	/** Repo-relative source-file list (tests included; they never define a barrel). */
	files: string[];
}

/**
 * Classifies every internal barrel folder as a `module` — its barrel hides
 * something, so it has a boundary worth enforcing — or a `domainFolder` — its
 * barrel re-exports every file, hiding nothing — by the standards'
 * barrel-omission test. Package/repo `src` roots (a root barrel is a package
 * API, not an internal module) and anything under a `common/` segment (its
 * contents are internal by definition) are excluded. Nested-module subtrees
 * are removed before the omission test, so a folder whose only descendants
 * live in nested modules omits nothing and stays a domainFolder — the safe
 * no-boundary degradation the friction log pre-logged.
 */
export const mapFolderModules = async ({
	cwd,
	files,
}: Params): Promise<Map<string, { status: 'module' | 'domainFolder'; barrelPath: string; exportedTargets: Set<string> }>> => {
	const barrelDirs = new Map<string, string>();

	for (const file of files) {
		const dir = dirname(file);

		if (isBarrel(file) && !isRootBarrelDir(dir) && !underCommon(dir)) {
			barrelDirs.set(dir, file);
		}
	}

	const nestedModuleDirs = [...barrelDirs.keys()];
	const map = new Map<string, { status: 'module' | 'domainFolder'; barrelPath: string; exportedTargets: Set<string> }>();

	for (const [folder, barrelPath] of barrelDirs) {
		const text = await readFile(join(cwd, barrelPath), 'utf8').catch(() => '');
		const exportedTargets = new Set(
			readBarrelExports({ barrelPath, text, files })
				.map((entry) => entry.target)
				.filter((target): target is string => target !== undefined),
		);

		const prefix = `${folder}/`;
		const hasOwnCommon = files.some((file) => file.startsWith(`${folder}/common/`));

		// The barrel is measured against the folder's OWN files: non-test,
		// non-index .ts(x) descendants at any depth, minus anything living inside
		// a nested module (that module's index.ts represents it instead).
		const ownFiles = files.filter((file) => {
			if (!file.startsWith(prefix) || isBarrel(file) || isTestFile(file) || !/\.tsx?$/.test(file)) {
				return false;
			}

			return !nestedModuleDirs.some((other) => other !== folder && other.startsWith(prefix) && file.startsWith(`${other}/`));
		});

		const omits = ownFiles.some((file) => !exportedTargets.has(file));
		const status = hasOwnCommon || omits ? 'module' : 'domainFolder';

		map.set(folder, { status, barrelPath, exportedTargets });
	}

	return map;
};
