import { expect, describe, test } from '@jest/globals';
import { getBaseName } from './getBaseName.ts';

describe('getBaseName', () => {
	test.each([
		{ path: 'src/feature/getLabel.ts', expected: 'getLabel.ts' },
		{ path: 'src/feature/components/Badge/index.tsx', expected: 'index.tsx' },
		{ path: 'src/feature', expected: 'feature' },
		{ path: 'package.json', expected: 'package.json' },
		{ path: 'src/common.utils/get.label.ts', expected: 'get.label.ts' },
	])('takes $expected from $path', ({ path, expected }) => {
		const name = getBaseName({ path });

		expect(name).toBe(expected);
	});

	test('a path ending in a separator has no last segment', () => {
		const name = getBaseName({ path: 'src/feature/' });

		expect(name).toBe('');
	});
});
