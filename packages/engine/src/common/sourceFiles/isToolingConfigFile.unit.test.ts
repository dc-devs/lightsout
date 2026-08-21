import { expect, test } from '@jest/globals';
import { isToolingConfigFile } from '#src/common/sourceFiles/isToolingConfigFile.ts';

const packagesDir = 'packages';

test.each([
	{ path: 'packages/engine/jest.config.cjs', packagesDir },
	{ path: 'packages/engine/jest.e2e.config.cjs', packagesDir },
	{ path: 'packages/shared/jest.config.cjs', packagesDir },
	{ path: 'vite.config.ts', packagesDir },
	{ path: 'jest.config.mjs', packagesDir },
	// the packages folder the workspace actually uses is what counts as a root
	{ path: 'apps/web/jest.config.cjs', packagesDir: 'apps' },
])('isToolingConfigFile: $path sits at a root, so it is not code under test', ({ path, packagesDir: dir }) => {
	const isTooling = isToolingConfigFile({ path, packagesDir: dir });

	expect(isTooling).toBe(true);
});

test.each([
	// The case the first version of this check got wrong: a real, testable file
	// whose name happens to end in .config.ts.
	{ case: 'a settings-shaped name inside a package source tree', path: 'packages/engine/src/feature.config.ts', packagesDir },
	{ case: 'a settings-shaped name deeper in a source tree', path: 'packages/web/src/routes/table.config.ts', packagesDir },
	{ case: 'a settings-shaped name in a root src tree', path: 'src/app.config.ts', packagesDir },
	{ case: 'a folder deeper than a package root', path: 'packages/engine/tooling/jest.config.cjs', packagesDir },
	{ case: 'an ordinary source file', path: 'packages/engine/src/main.ts', packagesDir },
	{ case: 'a source file whose name merely mentions config', path: 'packages/engine/src/readConfig.ts', packagesDir },
	{ case: 'a JSON file', path: 'lightsout.config.json', packagesDir },
	{ case: 'a file named config with no tool prefix', path: 'config.ts', packagesDir },
	{ case: 'a package root under a packages dir the workspace does not use', path: 'apps/web/jest.config.cjs', packagesDir },
])('isToolingConfigFile: $case never matches', ({ path, packagesDir: dir }) => {
	const isTooling = isToolingConfigFile({ path, packagesDir: dir });

	expect(isTooling).toBe(false);
});
