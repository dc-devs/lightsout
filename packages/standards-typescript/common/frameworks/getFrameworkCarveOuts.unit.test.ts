import { describe, expect, test } from '@jest/globals';
import { getFrameworkCarveOuts } from './getFrameworkCarveOuts.ts';

/** Declared dependency names per package directory, exactly as the file-list input carries them. */
const setupDependencies = ({ packages }: { packages: Array<[string, string[]]> }) => new Map(packages);

describe('getFrameworkCarveOuts', () => {
	test.each([
		{ dependency: 'react', expected: { exemptFolderNames: ['components', 'hooks'], kebabCase: false, routerRoots: [], moduleFolders: [] } },
		{ dependency: 'react-dom', expected: { exemptFolderNames: ['components', 'hooks'], kebabCase: false, routerRoots: [], moduleFolders: [] } },
		{
			dependency: '@nestjs/core',
			expected: { exemptFolderNames: ['controllers', 'models', 'services'], kebabCase: true, routerRoots: [], moduleFolders: [] },
		},
		{ dependency: 'next', expected: { exemptFolderNames: [], kebabCase: false, routerRoots: ['app', 'pages'], moduleFolders: [] } },
		{
			dependency: '@tanstack/react-router',
			expected: { exemptFolderNames: [], kebabCase: false, routerRoots: ['routes'], moduleFolders: ['features/*/screens/*'] },
		},
		{ dependency: '@remix-run/react', expected: { exemptFolderNames: [], kebabCase: false, routerRoots: ['routes'], moduleFolders: [] } },
		{ dependency: 'expo-router', expected: { exemptFolderNames: [], kebabCase: false, routerRoots: ['app'], moduleFolders: [] } },
	])('$dependency earns exactly the exemptions its own layout mandates', ({ dependency, expected }) => {
		const dependencies = setupDependencies({ packages: [['.', [dependency]]] });

		const carveOuts = getFrameworkCarveOuts({ dependencies });

		expect(carveOuts).toStrictEqual([{ directory: '.', ...expected }]);
	});

	test('merges every framework a package declares, naming each exemption once', () => {
		const dependencies = setupDependencies({ packages: [['.', ['react', 'react-dom', 'next', 'zod']]] });

		const carveOuts = getFrameworkCarveOuts({ dependencies });

		expect(carveOuts).toStrictEqual([
			{ directory: '.', exemptFolderNames: ['components', 'hooks'], kebabCase: false, routerRoots: ['app', 'pages'], moduleFolders: [] },
		]);
	});

	test('still gives a package whose dependencies name no known framework an entry, with no exemptions at all', () => {
		const dependencies = setupDependencies({ packages: [['.', ['zod', 'typescript']]] });

		const carveOuts = getFrameworkCarveOuts({ dependencies });

		expect(carveOuts).toStrictEqual([{ directory: '.', exemptFolderNames: [], kebabCase: false, routerRoots: [], moduleFolders: [] }]);
	});

	test('gives each package its own answer rather than the union across the repo', () => {
		const dependencies = setupDependencies({
			packages: [
				['.', ['react']],
				['packages/api', ['@nestjs/core']],
			],
		});

		const carveOuts = getFrameworkCarveOuts({ dependencies });

		expect(carveOuts).toStrictEqual([
			{ directory: 'packages/api', exemptFolderNames: ['controllers', 'models', 'services'], kebabCase: true, routerRoots: [], moduleFolders: [] },
			{ directory: '.', exemptFolderNames: ['components', 'hooks'], kebabCase: false, routerRoots: [], moduleFolders: [] },
		]);
	});

	test('orders the longest package directory first, so the repo root is reached only last', () => {
		const dependencies = setupDependencies({
			packages: [
				['.', []],
				['packages/api', []],
				['apps/web/admin', []],
			],
		});

		const carveOuts = getFrameworkCarveOuts({ dependencies });

		expect(carveOuts.map(({ directory }) => directory)).toStrictEqual(['apps/web/admin', 'packages/api', '.']);
	});

	test('a repo whose packages declare nothing at all yields no carve-outs', () => {
		const dependencies = setupDependencies({ packages: [] });

		const carveOuts = getFrameworkCarveOuts({ dependencies });

		expect(carveOuts).toStrictEqual([]);
	});
});
