import { describe, expect, test } from '@jest/globals';
import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { isFrameworkNamedTest } from './isFrameworkNamedTest.ts';

const setupCarveOut = ({
	directory = '.',
	entryFiles = ['router.tsx'],
	routerRoots = ['routes'],
}: {
	directory?: string;
	entryFiles?: string[];
	routerRoots?: string[];
} = {}): FrameworkCarveOut => ({
	directory,
	entryFiles,
	exemptFolderNames: [],
	kebabCase: false,
	routerRoots,
	moduleFolders: [],
});

describe('isFrameworkNamedTest', () => {
	test('a test under a router root sits beside a name the framework filled with dots', () => {
		expect(isFrameworkNamedTest({ test: 'src/routes/runs.$runId.unit.test.tsx', carveOut: setupCarveOut() })).toBe(true);
	});

	test('a test elsewhere in src resolves through the ordinary first-segment rule', () => {
		expect(isFrameworkNamedTest({ test: 'src/features/runs/loadRuns.unit.test.ts', carveOut: setupCarveOut() })).toBe(false);
	});

	test('a test beside a convention-resolved entry file earns nothing — that name carries no dots to own', () => {
		expect(isFrameworkNamedTest({ test: 'src/router.unit.test.tsx', carveOut: setupCarveOut() })).toBe(false);
	});

	test('outside the governing package’s src, a fixture tree keeps its ordinary resolution', () => {
		const carveOut = setupCarveOut({ directory: 'packages/web-app' });

		expect(isFrameworkNamedTest({ test: 'packages/web-app/fixtures/routes/runs.unit.test.tsx', carveOut })).toBe(false);
		expect(isFrameworkNamedTest({ test: 'packages/other/src/routes/runs.unit.test.tsx', carveOut })).toBe(false);
	});
});
