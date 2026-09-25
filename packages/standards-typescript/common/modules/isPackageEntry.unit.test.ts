import { describe, expect, test } from '@jest/globals';
import type { PackageEntries } from '../types/PackageEntries.ts';
import { isPackageEntry } from './isPackageEntry.ts';

const entries: PackageEntries = {
	packageDirectories: new Set(['.', 'packages/engine']),
	entryFiles: new Set(['packages/engine/src/contracts/index.ts', 'packages/engine/src/main.ts']),
};

describe('isPackageEntry', () => {
	test.each([
		{ path: 'index.ts', why: 'an index file at the root package' },
		{ path: 'src/index.ts', why: 'an index file in the root package’s src/' },
		{ path: 'packages/engine/src/index.tsx', why: 'an index file in a workspace package’s src/' },
		{ path: 'packages/engine/src/contracts/index.ts', why: 'a subpath export the manifest names' },
		{ path: 'packages/engine/src/main.ts', why: 'a file the manifest names, index or not' },
	])('accepts $why', ({ path }) => {
		expect(isPackageEntry({ path, entries })).toBe(true);
	});

	test.each([
		{ path: 'src/ingestion/index.ts', why: 'a folder’s index file' },
		{ path: 'packages/engine/src/queue/index.ts', why: 'a folder index inside a workspace package' },
		{ path: 'src/main.ts', why: 'a file that is no index file and no manifest names' },
	])('rejects $why', ({ path }) => {
		expect(isPackageEntry({ path, entries })).toBe(false);
	});
});
