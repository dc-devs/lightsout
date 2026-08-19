import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getDependencyNames } from '@/common/utils/getDependencyNames';
import { type FileListInput, StandardsInputKind } from '@/contracts';

interface Params {
	cwd: string;
	source: string[];
	tests: string[];
	files: string[];
	referenceFiles: string[];
	/** Repo-relative standards package roots, from the walk that listed the files. */
	standardsPackages: string[];
	/** Monorepo package parent dir (config `packages-dir`, default 'packages'). */
	packagesDir: string;
}

/**
 * The path-only input, plus the one fact it carries that a path list cannot
 * show: what each package declares it depends on. The declarations are read
 * the same way channel detection reads them, so a rule asking "does this repo
 * use React?" gets the same answer either route.
 *
 * @param packagesDir - monorepo package parent dir; each child holding a package.json becomes an entry
 */
export const buildFileListInput = async ({ cwd, source, tests, files, referenceFiles, standardsPackages, packagesDir }: Params): Promise<FileListInput> => {
	const dependencies = new Map<string, string[]>();

	dependencies.set('.', (await getDependencyNames({ manifestPath: join(cwd, 'package.json') })) ?? []);

	const children = await readdir(join(cwd, packagesDir)).catch(() => []);

	for (const name of children.sort()) {
		const names = await getDependencyNames({ manifestPath: join(cwd, packagesDir, name, 'package.json') });

		if (names !== undefined) {
			dependencies.set(`${packagesDir}/${name}`, names);
		}
	}

	return { kind: StandardsInputKind.FileList, cwd, source, tests, files, referenceFiles, dependencies, standardsPackages };
};
