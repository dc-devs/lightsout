import { describe, expect, test } from '@jest/globals';
import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { getSourceRoot } from './getSourceRoot.ts';

/** A carve-out as `getFrameworkCarveOuts` builds it — only the directory matters to the anchor. */
const setupCarveOut = ({ directory }: { directory: string }): FrameworkCarveOut => ({
	directory,
	entryFiles: [],
	exemptFolderNames: [],
	kebabCase: false,
	moduleFolders: [],
	routerRoots: [],
});

describe('getSourceRoot', () => {
	test('anchors the repo root package at its own src/', () => {
		const carveOut = setupCarveOut({ directory: '.' });

		const sourceRoot = getSourceRoot({ carveOut });

		expect(sourceRoot).toBe('src/');
	});

	test('anchors a workspace package inside the package directory, so a sibling package is out of scope', () => {
		const carveOut = setupCarveOut({ directory: 'packages/api' });

		const sourceRoot = getSourceRoot({ carveOut });

		expect(sourceRoot).toBe('packages/api/src/');
	});
});
