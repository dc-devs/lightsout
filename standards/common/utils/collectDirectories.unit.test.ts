import { describe, expect, test } from '@jest/globals';
import { collectDirectories } from './collectDirectories.ts';

describe('collectDirectories', () => {
	test('names every folder holding a file, and each of its ancestors', () => {
		const directories = collectDirectories({ files: ['src/billing/common/utils/formatRate.ts'] });

		// a file list never names the folders between its entries, so the rules that
		// judge folders derive them
		expect([...directories].sort()).toStrictEqual(['src', 'src/billing', 'src/billing/common', 'src/billing/common/utils']);
	});

	test('never names the repo root, which those rules would have to filter back out', () => {
		const directories = collectDirectories({ files: ['index.ts', 'src/app.ts'] });

		expect([...directories].sort()).toStrictEqual(['src']);
	});

	test('names a shared ancestor once however many files sit under it', () => {
		const directories = collectDirectories({ files: ['src/a/one.ts', 'src/a/two.ts', 'src/b/three.ts'] });

		expect([...directories].sort()).toStrictEqual(['src', 'src/a', 'src/b']);
	});

	test('no files means no folders', () => {
		expect([...collectDirectories({ files: [] })]).toStrictEqual([]);
	});
});
