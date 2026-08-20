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
	test('a folder matching the framework’s shape is mandated, in the repo root package and in a workspace one', () => {
		expect(isMandatedModuleFolder({ folder: 'src/features/app/screens/RunsIndex', carveOut: setupCarveOut() })).toBe(true);
		expect(
			isMandatedModuleFolder({
				folder: 'packages/web-app/src/features/app/screens/RunsIndex',
				carveOut: setupCarveOut({ directory: 'packages/web-app' }),
			}),
		).toBe(true);
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
