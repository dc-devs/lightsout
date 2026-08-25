import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readDependencyNames } from '#src/common/workspace/readDependencyNames.ts';

interface Params {
	cwd: string;
	packagesDir: string;
}

/**
 * What each package declares it depends on, keyed by repo-relative package root
 * (`.` for the repo itself).
 *
 * This is the one fact a path list cannot show and several rules turn on: a
 * framework carve-out is keyed on what a package DECLARES, so a rule asking
 * "does this package use a file-based router?" needs the manifests. Read the
 * same way channel detection reads them, so both routes give the same answer.
 *
 * @param packagesDir - monorepo package parent dir (config `packages-dir`, default 'packages'); each child holding a package.json becomes an entry
 */
export const readPackageDependencies = async ({ cwd, packagesDir }: Params): Promise<Map<string, string[]>> => {
	const dependencies = new Map<string, string[]>();

	dependencies.set('.', (await readDependencyNames({ manifestPath: join(cwd, 'package.json') })) ?? []);

	const children = await readdir(join(cwd, packagesDir)).catch(() => []);

	for (const name of children.sort()) {
		const names = await readDependencyNames({ manifestPath: join(cwd, packagesDir, name, 'package.json') });

		if (names !== undefined) {
			dependencies.set(`${packagesDir}/${name}`, names);
		}
	}

	return dependencies;
};
