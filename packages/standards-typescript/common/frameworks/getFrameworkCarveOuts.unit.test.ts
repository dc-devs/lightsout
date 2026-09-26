import { describe, expect, test } from '@jest/globals';
import { getFrameworkCarveOuts } from './getFrameworkCarveOuts.ts';

/** Declared dependency names per package directory, exactly as the file-list input carries them. */
const setupDependencies = ({ packages }: { packages: Array<[string, string[]]> }) => new Map(packages);

describe('getFrameworkCarveOuts', () => {
	test.each([
		{
			dependency: '@nestjs/core',
			expected: { entryFiles: ['main.ts'], exemptFolderNames: [], kebabCase: true, routerRoots: [] },
		},
		{ dependency: 'next', expected: { entryFiles: [], exemptFolderNames: [], kebabCase: false, routerRoots: ['app', 'pages'] } },
		{
			dependency: '@tanstack/react-router',
			expected: { entryFiles: [], exemptFolderNames: [], kebabCase: false, routerRoots: ['routes'] },
		},
		{
			dependency: '@tanstack/react-start',
			expected: {
				entryFiles: ['router.tsx', 'server.ts', 'client.tsx'],
				exemptFolderNames: [],
				kebabCase: false,
				routerRoots: ['routes'],
			},
		},
		{ dependency: '@remix-run/react', expected: { entryFiles: [], exemptFolderNames: [], kebabCase: false, routerRoots: ['routes'] } },
		{ dependency: 'expo-router', expected: { entryFiles: [], exemptFolderNames: [], kebabCase: false, routerRoots: ['app'] } },
	])('$dependency earns exactly the exemptions its own layout mandates', ({ dependency, expected }) => {
		const dependencies = setupDependencies({ packages: [['.', [dependency]]] });

		const carveOuts = getFrameworkCarveOuts({ dependencies });

		expect(carveOuts).toStrictEqual([{ directory: '.', ...expected }]);
	});

	test.each([{ dependency: 'react' }, { dependency: 'react-dom' }])(
		'$dependency earns nothing at all, its own documents mandating no folder layout for the table to carry',
		({ dependency }) => {
			const dependencies = setupDependencies({ packages: [['.', [dependency]]] });

			const carveOuts = getFrameworkCarveOuts({ dependencies });

			expect(carveOuts).toStrictEqual([{ directory: '.', entryFiles: [], exemptFolderNames: [], kebabCase: false, routerRoots: [] }]);
		},
	);

	test('merges every framework a package declares, naming each mandate once', () => {
		const dependencies = setupDependencies({ packages: [['.', ['@nestjs/core', 'next', 'zod']]] });

		const carveOuts = getFrameworkCarveOuts({ dependencies });

		expect(carveOuts).toStrictEqual([{ directory: '.', entryFiles: ['main.ts'], exemptFolderNames: [], kebabCase: true, routerRoots: ['app', 'pages'] }]);
	});

	test('a package declaring a framework the table knows still gets an empty folder-name dimension — the contract, not an oversight', () => {
		const dependencies = setupDependencies({ packages: [['.', ['@tanstack/react-router', '@nestjs/core']]] });

		const [carveOut] = getFrameworkCarveOuts({ dependencies });

		// no framework's own documents mandate a folder name, so the question
		// built on it answers no everywhere until one does
		expect(carveOut?.exemptFolderNames).toStrictEqual([]);
	});

	test('dedupes a router root two frameworks both mandate, and keeps what each of them alone earns', () => {
		const dependencies = setupDependencies({ packages: [['.', ['@tanstack/react-router', '@tanstack/react-start']]] });

		const carveOuts = getFrameworkCarveOuts({ dependencies });

		expect(carveOuts).toStrictEqual([
			{
				directory: '.',
				entryFiles: ['router.tsx', 'server.ts', 'client.tsx'],
				exemptFolderNames: [],
				kebabCase: false,
				routerRoots: ['routes'],
			},
		]);
	});

	test('still gives a package whose dependencies name no known framework an entry, with no exemptions at all', () => {
		const dependencies = setupDependencies({ packages: [['.', ['zod', 'typescript']]] });

		const carveOuts = getFrameworkCarveOuts({ dependencies });

		expect(carveOuts).toStrictEqual([{ directory: '.', entryFiles: [], exemptFolderNames: [], kebabCase: false, routerRoots: [] }]);
	});

	test('gives each package its own answer rather than the union across the repo', () => {
		const dependencies = setupDependencies({
			packages: [
				['.', ['@tanstack/react-router']],
				['packages/api', ['@nestjs/core']],
			],
		});

		const carveOuts = getFrameworkCarveOuts({ dependencies });

		expect(carveOuts).toStrictEqual([
			{
				directory: 'packages/api',
				entryFiles: ['main.ts'],
				exemptFolderNames: [],
				kebabCase: true,
				routerRoots: [],
			},
			{ directory: '.', entryFiles: [], exemptFolderNames: [], kebabCase: false, routerRoots: ['routes'] },
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
