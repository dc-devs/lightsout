import { describe, expect, test } from '@jest/globals';
import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { isEntryFile } from './isEntryFile.ts';

/** A carve-out as `getFrameworkCarveOuts` builds it — TanStack Start's entries unless a test names its own. */
const setupCarveOut = ({
	directory = '.',
	entryFiles = ['router.tsx', 'server.ts', 'client.tsx'],
}: {
	directory?: string;
	entryFiles?: string[];
} = {}): FrameworkCarveOut => ({
	directory,
	entryFiles,
	exemptFolderNames: [],
	kebabCase: false,
	moduleFolders: [],
	routerRoots: [],
});

describe('isEntryFile', () => {
	test.each([{ path: 'src/router.tsx' }, { path: 'src/server.ts' }, { path: 'src/client.tsx' }])(
		'$path is a file the framework resolves by convention, not one the author wrote for a consumer',
		({ path }) => {
			const carveOut = setupCarveOut();

			const isEntry = isEntryFile({ path, carveOut });

			expect(isEntry).toBe(true);
		},
	);

	test("anchors to the package's own src/, not the workspace root's", () => {
		const carveOut = setupCarveOut({ directory: 'packages/web-app' });

		const isEntry = isEntryFile({ path: 'packages/web-app/src/router.tsx', carveOut });

		expect(isEntry).toBe(true);
	});

	test("a path outside that package is not its entry file, whatever that package's own framework mandates", () => {
		const carveOut = setupCarveOut({ directory: 'packages/web-app' });

		const isEntry = isEntryFile({ path: 'packages/engine/src/router.tsx', carveOut });

		expect(isEntry).toBe(false);
	});

	test("a same-named file deeper in the tree is the author's, not the framework's", () => {
		const carveOut = setupCarveOut();

		const isEntry = isEntryFile({ path: 'src/features/runs/router.tsx', carveOut });

		expect(isEntry).toBe(false);
	});

	test('an entry the framework resolves below src/ matches on the whole src-relative path', () => {
		const carveOut = setupCarveOut({ entryFiles: ['app/router.tsx'] });

		const isEntry = isEntryFile({ path: 'src/app/router.tsx', carveOut });

		expect(isEntry).toBe(true);
	});

	test('a file the framework does not name is an ordinary source file', () => {
		const carveOut = setupCarveOut();

		const isEntry = isEntryFile({ path: 'src/index.tsx', carveOut });

		expect(isEntry).toBe(false);
	});

	test('a package that declares no framework this table knows has no entry files to exempt', () => {
		const carveOut = setupCarveOut({ entryFiles: [] });

		const isEntry = isEntryFile({ path: 'src/router.tsx', carveOut });

		expect(isEntry).toBe(false);
	});
});
