import { describe, expect, test } from '@jest/globals';
import { readPackageEntries } from './readPackageEntries.ts';

describe('readPackageEntries', () => {
	test('names every file a manifest publishes, however deeply its exports nest', () => {
		const contents = new Map([
			[
				'packages/engine/package.json',
				JSON.stringify({
					main: './src/main.ts',
					types: 'src/types.ts',
					exports: { '.': { import: './src/index.ts', default: ['./src/index.ts'] }, './contracts': './src/contracts/index.ts' },
				}),
			],
		]);

		const { packageDirectories, entryFiles } = readPackageEntries({ contents });

		expect(packageDirectories).toStrictEqual(new Set(['packages/engine']));
		expect(entryFiles).toStrictEqual(
			new Set(['packages/engine/src/main.ts', 'packages/engine/src/types.ts', 'packages/engine/src/index.ts', 'packages/engine/src/contracts/index.ts']),
		);
	});

	test('reads a manifest at the repo root, and skips text that is no manifest', () => {
		const contents = new Map([
			['package.json', JSON.stringify({ exports: './src/index.ts', bin: './cli.js' })],
			['src/package.json', 'not json'],
			['lib/package.json', '[]'],
			['src/index.ts', "export { a } from './a';"],
		]);

		const { packageDirectories, entryFiles } = readPackageEntries({ contents });

		expect(packageDirectories).toStrictEqual(new Set(['.']));
		expect(entryFiles).toStrictEqual(new Set(['src/index.ts']));
	});

	test('reads a repo with no manifest as one package rooted at the repo root', () => {
		const { packageDirectories, entryFiles } = readPackageEntries({ contents: new Map([['src/index.ts', '']]) });

		expect(packageDirectories).toStrictEqual(new Set(['.']));
		expect(entryFiles).toStrictEqual(new Set());
	});

	test('ignores a field that holds no path', () => {
		const contents = new Map([['package.json', JSON.stringify({ main: 3, exports: null })]]);

		const { entryFiles } = readPackageEntries({ contents });

		expect(entryFiles).toStrictEqual(new Set());
	});
});
