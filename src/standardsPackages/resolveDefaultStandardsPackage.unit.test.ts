import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, describe, test, jest } from '@jest/globals';
import { resolveDefaultStandardsPackage } from '@/standardsPackages';

/** A temp tree with a packaged standards folder at `packagedAt`, and a deep directory to start the walk from. */
const setupTree = ({ packagedAt }: { packagedAt?: string } = {}) => {
	const root = mkdtempSync(join(tmpdir(), 'lightsout-default-package-'));
	const startDir = join(root, 'plugin', 'dist', 'chunks');

	mkdirSync(startDir, { recursive: true });

	if (packagedAt !== undefined) {
		mkdirSync(join(root, packagedAt), { recursive: true });
		writeFileSync(join(root, packagedAt, 'lightsout-standards.json'), '{ "name": "lightsout defaults", "formatVersion": 1 }\n');
	}

	return { root, startDir };
};

/**
 * The same temp tree, with no `startDir` passed in — so the walk has to work out
 * where it is standing on its own, either from the path the program was invoked
 * with or, when there is no such path, from the working directory.
 */
const setupWalkWithNoStartDir = ({ standingOn }: { standingOn: 'invokedPath' | 'workingDirectory' }) => {
	const { root, startDir } = setupTree({ packagedAt: 'plugin/standards' });

	if (standingOn === 'invokedPath') {
		jest.replaceProperty(process, 'argv', [process.execPath, join(root, 'plugin', 'dist', 'cli.mjs')]);
	} else {
		jest.replaceProperty(process, 'argv', [process.execPath]);
		jest.spyOn(process, 'cwd').mockReturnValue(startDir);
	}

	return { root };
};

describe('resolveDefaultStandardsPackage', () => {
	test('finds the standards folder shipped beside the bundled program', () => {
		const { root, startDir } = setupTree({ packagedAt: 'plugin/standards' });

		const packagePath = resolveDefaultStandardsPackage({ startDir });

		// the installed layout: <plugin>/dist/ beside <plugin>/standards/
		expect(packagePath).toBe(join(root, 'plugin', 'standards'));
	});

	test("finds this repo's dev layout, where the standards folder sits under plugin/", () => {
		const { root } = setupTree({ packagedAt: 'plugin/standards' });

		const packagePath = resolveDefaultStandardsPackage({ startDir: root });

		// a repo root has no standards/ of its own — plugin/standards/ is the dev layout's home
		expect(packagePath).toBe(join(root, 'plugin', 'standards'));
	});

	test('starts from the bundle it was invoked as when the caller names no starting directory', () => {
		const { root } = setupWalkWithNoStartDir({ standingOn: 'invokedPath' });

		const packagePath = resolveDefaultStandardsPackage();

		// invoked as <root>/plugin/dist/cli.mjs, so the walk begins in <root>/plugin/dist
		expect(packagePath).toBe(join(root, 'plugin', 'standards'));
	});

	test('falls back to the working directory when nothing recorded how the program was invoked', () => {
		const { root } = setupWalkWithNoStartDir({ standingOn: 'workingDirectory' });

		const packagePath = resolveDefaultStandardsPackage();

		expect(packagePath).toBe(join(root, 'plugin', 'standards'));
	});

	test('says plainly that the engine has no standards beside it when the walk reaches the filesystem root', () => {
		const { startDir } = setupTree();

		// no standards folder anywhere above the start — a plain sentence, not a stack of paths
		expect(() => resolveDefaultStandardsPackage({ startDir })).toThrow('bundled default standards not found next to the engine');
	});
});
