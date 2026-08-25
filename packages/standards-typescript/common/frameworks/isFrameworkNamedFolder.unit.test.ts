import { describe, expect, test } from '@jest/globals';
import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { isFrameworkNamedFolder } from './isFrameworkNamedFolder.ts';

const setupCarveOut = ({
	directory = '.',
	exemptFolderNames = ['controllers'],
}: {
	directory?: string;
	exemptFolderNames?: string[];
} = {}): FrameworkCarveOut => ({
	directory,
	entryFiles: [],
	exemptFolderNames,
	kebabCase: false,
	routerRoots: [],
	moduleFolders: [],
});

describe('isFrameworkNamedFolder', () => {
	test.each([
		{ placement: 'the repo root package', directory: '.', folder: 'src/events/controllers' },
		{ placement: 'a workspace package', directory: 'packages/api', folder: 'packages/api/src/events/controllers' },
	])('a folder whose name the framework mandates is named by it in $placement', ({ directory, folder }) => {
		const named = isFrameworkNamedFolder({ folder, carveOut: setupCarveOut({ directory }) });

		expect(named).toBe(true);
	});

	test('a name the framework does not mandate is the author’s', () => {
		expect(isFrameworkNamedFolder({ folder: 'src/events/helpers', carveOut: setupCarveOut() })).toBe(false);
	});

	test('outside the governing package’s src, a fixture tree cannot pick up a mandate meant for source', () => {
		const carveOut = setupCarveOut({ directory: 'packages/api' });

		expect(isFrameworkNamedFolder({ folder: 'packages/api/tests/controllers', carveOut })).toBe(false);
		expect(isFrameworkNamedFolder({ folder: 'packages/other/src/controllers', carveOut })).toBe(false);
	});

	test('with no mandated names — every framework in today’s table — the question answers no', () => {
		// the deliberate state after the primitives-only strip: React mandates no
		// layout and NestJS wires by decorators, so neither fills this dimension
		const carveOut = setupCarveOut({ exemptFolderNames: [] });

		expect(isFrameworkNamedFolder({ folder: 'src/events/controllers', carveOut })).toBe(false);
		expect(isFrameworkNamedFolder({ folder: 'src/features/components', carveOut })).toBe(false);
	});
});
