import { describe, expect, test } from '@jest/globals';
import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { isMandatedModuleFolder } from './isMandatedModuleFolder.ts';

const setupCarveOut = ({
	directory = '.',
	moduleFolders = ['features/*/screens/*'],
}: {
	directory?: string;
	moduleFolders?: string[];
} = {}): FrameworkCarveOut => ({
	directory,
	exemptFolderNames: [],
	kebabCase: false,
	routerRoots: [],
	moduleFolders,
});

describe('isMandatedModuleFolder', () => {
	test.each([
		{ placement: 'the repo root package', directory: '.', folder: 'src/features/app/screens/RunsIndex' },
		{ placement: 'a workspace package', directory: 'packages/web-app', folder: 'packages/web-app/src/features/app/screens/RunsIndex' },
	])('a folder matching the framework’s shape is mandated in $placement', ({ directory, folder }) => {
		const carveOut = setupCarveOut({ directory });

		const mandated = isMandatedModuleFolder({ folder, carveOut });

		expect(mandated).toBe(true);
	});

	test('a `*` matches exactly one segment, so a pattern cannot swallow a subtree', () => {
		const carveOut = setupCarveOut();

		// deeper than the pattern — a screen's own components folder is not itself a screen
		expect(isMandatedModuleFolder({ folder: 'src/features/app/screens/RunsIndex/components', carveOut })).toBe(false);
		// shallower than the pattern
		expect(isMandatedModuleFolder({ folder: 'src/features/app/screens', carveOut })).toBe(false);
		expect(isMandatedModuleFolder({ folder: 'src/features/app', carveOut })).toBe(false);
	});

	test('the same shape somewhere else in the tree earns nothing', () => {
		const carveOut = setupCarveOut();

		expect(isMandatedModuleFolder({ folder: 'src/lib/app/screens/RunsIndex', carveOut })).toBe(false);
		expect(isMandatedModuleFolder({ folder: 'src/features/app/panes/RunsIndex', carveOut })).toBe(false);
	});

	test('outside the governing package’s src, a fixture tree cannot pick up a mandate meant for source', () => {
		const carveOut = setupCarveOut({ directory: 'packages/web-app' });

		expect(isMandatedModuleFolder({ folder: 'packages/web-app/tests/features/app/screens/RunsIndex', carveOut })).toBe(false);
		expect(isMandatedModuleFolder({ folder: 'packages/other/src/features/app/screens/RunsIndex', carveOut })).toBe(false);
	});

	test('a package whose framework mandates no module folders never matches', () => {
		expect(isMandatedModuleFolder({ folder: 'src/features/app/screens/RunsIndex', carveOut: setupCarveOut({ moduleFolders: [] }) })).toBe(false);
	});
});
