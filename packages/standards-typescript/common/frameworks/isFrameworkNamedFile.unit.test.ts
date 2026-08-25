import { describe, expect, test } from '@jest/globals';
import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { isFrameworkNamedFile } from './isFrameworkNamedFile.ts';

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

describe('isFrameworkNamedFile', () => {
	test('a file under the package’s router root is named by the router, whatever it exports', () => {
		const carveOut = setupCarveOut();

		expect(isFrameworkNamedFile({ path: 'src/routes/runs.$runId.tsx', carveOut })).toBe(true);
		expect(isFrameworkNamedFile({ path: 'src/routes/__root.tsx', carveOut })).toBe(true);
	});

	test('a file the framework resolves by convention was named by the framework too', () => {
		expect(isFrameworkNamedFile({ path: 'src/router.tsx', carveOut: setupCarveOut() })).toBe(true);
	});

	test('an ordinary source file is the author’s to name', () => {
		const carveOut = setupCarveOut();

		expect(isFrameworkNamedFile({ path: 'src/features/runs/loadRuns.ts', carveOut })).toBe(false);
		// the same base name deeper in the tree is an author's file, not the entry one
		expect(isFrameworkNamedFile({ path: 'src/features/runs/router.tsx', carveOut })).toBe(false);
	});

	test('outside the governing package’s src, neither half applies', () => {
		const carveOut = setupCarveOut({ directory: 'packages/web-app' });

		expect(isFrameworkNamedFile({ path: 'packages/web-app/fixtures/routes/runs.tsx', carveOut })).toBe(false);
		expect(isFrameworkNamedFile({ path: 'packages/other/src/routes/runs.tsx', carveOut })).toBe(false);
		expect(isFrameworkNamedFile({ path: 'packages/other/src/router.tsx', carveOut })).toBe(false);
	});

	test('a package whose framework names nothing keeps every filename the author’s', () => {
		const carveOut = setupCarveOut({ entryFiles: [], routerRoots: [] });

		expect(isFrameworkNamedFile({ path: 'src/routes/runs.tsx', carveOut })).toBe(false);
		expect(isFrameworkNamedFile({ path: 'src/router.tsx', carveOut })).toBe(false);
	});
});
