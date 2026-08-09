import { expect, describe, test } from '@jest/globals';
import { resolveRelativeImport } from './resolveRelativeImport.ts';

/** The universe a specifier resolves against, as every caller hands it over. */
const setupScope = ({ paths }: { paths: string[] }) => ({ files: new Set(paths) });

describe('resolveRelativeImport', () => {
	test.each([
		{ kind: 'a configured alias', specifier: '@/common/utils/formatRate' },
		{ kind: 'a node builtin', specifier: 'node:path' },
		{ kind: 'a published package', specifier: 'zod' },
	])('leaves $kind unresolved, since only a relative path names a file in scope', ({ specifier }) => {
		const { files } = setupScope({ paths: ['src/billing/getChargeLabel.ts', 'src/common/utils/formatRate.ts'] });

		const target = resolveRelativeImport({ from: 'src/billing/getChargeLabel.ts', specifier, files });

		expect(target).toBeUndefined();
	});

	test.each([
		{
			specifier: './formatRate',
			paths: ['src/billing/formatRate.ts'],
			expected: 'src/billing/formatRate.ts',
		},
		{
			specifier: '../common/utils/formatRate',
			paths: ['src/common/utils/formatRate.ts'],
			expected: 'src/common/utils/formatRate.ts',
		},
		{
			specifier: './Badge',
			paths: ['src/billing/Badge.tsx'],
			expected: 'src/billing/Badge.tsx',
		},
		{
			specifier: './widget',
			paths: ['src/billing/widget/index.ts'],
			expected: 'src/billing/widget/index.ts',
		},
		{
			specifier: './widget',
			paths: ['src/billing/widget/index.tsx'],
			expected: 'src/billing/widget/index.tsx',
		},
	])('resolves $specifier to $expected', ({ specifier, paths, expected }) => {
		const { files } = setupScope({ paths: ['src/billing/getChargeLabel.ts', ...paths] });

		const target = resolveRelativeImport({ from: 'src/billing/getChargeLabel.ts', specifier, files });

		expect(target).toBe(expected);
	});

	test('takes the file over the folder barrel of the same name, in the order a bundler would', () => {
		const { files } = setupScope({
			paths: ['src/billing/getChargeLabel.ts', 'src/billing/widget.ts', 'src/billing/widget/index.ts'],
		});

		const target = resolveRelativeImport({ from: 'src/billing/getChargeLabel.ts', specifier: './widget', files });

		expect(target).toBe('src/billing/widget.ts');
	});

	test('answers undefined for a relative path the run never listed, rather than a file nobody has', () => {
		const { files } = setupScope({ paths: ['src/billing/getChargeLabel.ts'] });

		const target = resolveRelativeImport({ from: 'src/billing/getChargeLabel.ts', specifier: './formatRate', files });

		expect(target).toBeUndefined();
	});

	test('anchors a specifier written at the repo root to the root itself', () => {
		const { files } = setupScope({ paths: ['index.ts', 'src/app/index.ts'] });

		const target = resolveRelativeImport({ from: 'index.ts', specifier: './src/app', files });

		expect(target).toBe('src/app/index.ts');
	});
});
