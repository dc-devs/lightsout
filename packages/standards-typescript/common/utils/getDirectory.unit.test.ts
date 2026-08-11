import { describe, expect, test } from '@jest/globals';
import { getDirectory } from './getDirectory.ts';

describe('getDirectory', () => {
	test('returns the folder a path sits in', () => {
		expect(getDirectory({ path: 'src/billing/common/utils/formatRate.ts' })).toBe('src/billing/common/utils');
	});

	test('returns the repo root as a dot when the path sits at the top level', () => {
		expect(getDirectory({ path: 'index.ts' })).toBe('.');
	});

	test('answers for a folder path as readily as a file path, which is how ancestors are walked', () => {
		expect(getDirectory({ path: 'src/billing/common' })).toBe('src/billing');
		expect(getDirectory({ path: 'src' })).toBe('.');
	});

	test('a trailing slash leaves the last segment empty rather than being trimmed away', () => {
		// the engine builds `/`-separated repo-relative paths and never a trailing
		// one, so this pins what the string work does rather than blessing the input
		expect(getDirectory({ path: 'src/billing/' })).toBe('src/billing');
	});
});
