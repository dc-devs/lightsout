import { describe, expect, test } from '@jest/globals';
import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { getPathCarveOut } from './getPathCarveOut.ts';

/** Carve-outs as `getFrameworkCarveOuts` hands them over: longest package directory first. */
const setupCarveOuts = ({ directories }: { directories: string[] }): FrameworkCarveOut[] =>
	directories.map((directory) => ({
		directory,
		exemptFolderNames: ['components'],
		kebabCase: false,
		routerRoots: [],
		moduleFolders: [],
	}));

describe('getPathCarveOut', () => {
	test('takes the nearest package, not the repo root that also matches', () => {
		const carveOuts = setupCarveOuts({ directories: ['packages/api', '.'] });

		const carveOut = getPathCarveOut({ carveOuts, path: 'packages/api/src/users' });

		expect(carveOut).toStrictEqual({
			directory: 'packages/api',
			exemptFolderNames: ['components'],
			kebabCase: false,
			routerRoots: [],
			moduleFolders: [],
		});
	});

	test('falls to the repo root entry for a path under no workspace package', () => {
		const carveOuts = setupCarveOuts({ directories: ['packages/api', '.'] });

		const carveOut = getPathCarveOut({ carveOuts, path: 'src/billing/invoices' });

		expect(carveOut.directory).toBe('.');
	});

	test('matches a package directory only at a folder boundary, so a longer name is a different package', () => {
		const carveOuts = setupCarveOuts({ directories: ['packages/api-tools', 'packages/api'] });

		const carveOut = getPathCarveOut({ carveOuts, path: 'packages/api-tools/src/build' });

		expect(carveOut.directory).toBe('packages/api-tools');
	});

	test("gives a path no package owns the doc's plain defaults rather than nothing", () => {
		const carveOuts = setupCarveOuts({ directories: ['packages/api'] });

		const carveOut = getPathCarveOut({ carveOuts, path: 'src/billing/invoices' });

		expect(carveOut).toStrictEqual({ directory: '.', exemptFolderNames: [], kebabCase: false, routerRoots: [], moduleFolders: [] });
	});
});
