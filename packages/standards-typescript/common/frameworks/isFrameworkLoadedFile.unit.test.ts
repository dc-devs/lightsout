import { describe, expect, test } from '@jest/globals';
import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { isFrameworkLoadedFile } from './isFrameworkLoadedFile.ts';

const setupCarveOut = ({
	directory = '.',
	entryFiles = ['router.tsx', 'main.ts'],
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

describe('isFrameworkLoadedFile', () => {
	test('the router loads its route files, so nothing in the tree has to import them', () => {
		expect(isFrameworkLoadedFile({ path: 'src/routes/runs.$runId.tsx', carveOut: setupCarveOut() })).toBe(true);
	});

	test('an index file under a router root is a route the router loads, not a barrel', () => {
		expect(isFrameworkLoadedFile({ path: 'src/routes/index.tsx', carveOut: setupCarveOut() })).toBe(true);
	});

	test('a convention-resolved entry file is reached by the framework too', () => {
		const carveOut = setupCarveOut();

		expect(isFrameworkLoadedFile({ path: 'src/router.tsx', carveOut })).toBe(true);
		expect(isFrameworkLoadedFile({ path: 'src/main.ts', carveOut })).toBe(true);
	});

	test('an ordinary source file is reached only by whatever imports it', () => {
		const carveOut = setupCarveOut();

		expect(isFrameworkLoadedFile({ path: 'src/features/runs/loadRuns.ts', carveOut })).toBe(false);
		expect(isFrameworkLoadedFile({ path: 'src/features/runs/index.ts', carveOut })).toBe(false);
	});

	test('outside the governing package’s src, neither half applies', () => {
		const carveOut = setupCarveOut({ directory: 'packages/web-app' });

		expect(isFrameworkLoadedFile({ path: 'packages/web-app/fixtures/routes/index.tsx', carveOut })).toBe(false);
		expect(isFrameworkLoadedFile({ path: 'packages/other/src/routes/index.tsx', carveOut })).toBe(false);
		expect(isFrameworkLoadedFile({ path: 'packages/other/src/main.ts', carveOut })).toBe(false);
	});

	test('a package declaring no framework loads nothing by itself', () => {
		const carveOut = setupCarveOut({ entryFiles: [], routerRoots: [] });

		expect(isFrameworkLoadedFile({ path: 'src/routes/index.tsx', carveOut })).toBe(false);
		expect(isFrameworkLoadedFile({ path: 'src/main.ts', carveOut })).toBe(false);
	});
});
