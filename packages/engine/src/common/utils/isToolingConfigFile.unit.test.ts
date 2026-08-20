import { expect, test } from '@jest/globals';
import { isToolingConfigFile } from '#src/common/utils/isToolingConfigFile.ts';

const packagesDir = 'packages';

test('isToolingConfigFile: a tool’s settings file at the repo root or a package root is not code under test', () => {
	expect(isToolingConfigFile({ path: 'packages/engine/jest.config.cjs', packagesDir })).toBe(true);
	expect(isToolingConfigFile({ path: 'packages/engine/jest.e2e.config.cjs', packagesDir })).toBe(true);
	expect(isToolingConfigFile({ path: 'packages/shared/jest.config.cjs', packagesDir })).toBe(true);
	expect(isToolingConfigFile({ path: 'vite.config.ts', packagesDir })).toBe(true);
	expect(isToolingConfigFile({ path: 'jest.config.mjs', packagesDir })).toBe(true);
});

test('isToolingConfigFile: a file inside a source tree is ordinary code, however it is named', () => {
	// The case the first version of this check got wrong: a real, testable file
	// whose name happens to end in .config.ts.
	expect(isToolingConfigFile({ path: 'packages/engine/src/feature.config.ts', packagesDir })).toBe(false);
	expect(isToolingConfigFile({ path: 'packages/web/src/routes/table.config.ts', packagesDir })).toBe(false);
	expect(isToolingConfigFile({ path: 'src/app.config.ts', packagesDir })).toBe(false);
	// Deeper than a package root, so not a root.
	expect(isToolingConfigFile({ path: 'packages/engine/tooling/jest.config.cjs', packagesDir })).toBe(false);
});

test('isToolingConfigFile: files that are not a tool’s settings file never match', () => {
	expect(isToolingConfigFile({ path: 'packages/engine/src/main.ts', packagesDir })).toBe(false);
	expect(isToolingConfigFile({ path: 'packages/engine/src/loadConfig.ts', packagesDir })).toBe(false);
	expect(isToolingConfigFile({ path: 'lightsout.config.json', packagesDir })).toBe(false);
	expect(isToolingConfigFile({ path: 'config.ts', packagesDir })).toBe(false);
});

test('isToolingConfigFile: the packages folder the workspace actually uses is what counts as a root', () => {
	expect(isToolingConfigFile({ path: 'apps/web/jest.config.cjs', packagesDir: 'apps' })).toBe(true);
	expect(isToolingConfigFile({ path: 'apps/web/jest.config.cjs', packagesDir })).toBe(false);
});
