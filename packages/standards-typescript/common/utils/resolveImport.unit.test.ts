import { describe, expect, test } from '@jest/globals';
import { resolveImport } from './resolveImport.ts';

/** The universe a specifier resolves against, plus the importing package's aliases. */
const setupScope = ({ paths, patterns }: { paths: string[]; patterns?: Array<[string, string[]]> }) => ({
	from: 'packages/engine/src/billing/getChargeLabel.ts',
	files: new Set(['packages/engine/src/billing/getChargeLabel.ts', ...paths]),
	aliases: patterns === undefined ? undefined : { base: 'packages/engine', patterns: new Map(patterns) },
});

describe('resolveImport', () => {
	test.each([
		{ specifier: './formatRate', paths: ['packages/engine/src/billing/formatRate.ts'], expected: 'packages/engine/src/billing/formatRate.ts' },
		{ specifier: '../common/formatRate', paths: ['packages/engine/src/common/formatRate.ts'], expected: 'packages/engine/src/common/formatRate.ts' },
		{ specifier: './Badge', paths: ['packages/engine/src/billing/Badge.tsx'], expected: 'packages/engine/src/billing/Badge.tsx' },
		{ specifier: './widget', paths: ['packages/engine/src/billing/widget/index.ts'], expected: 'packages/engine/src/billing/widget/index.ts' },
	])('resolves the relative specifier $specifier to the file in scope', ({ specifier, paths, expected }) => {
		const { from, files, aliases } = setupScope({ paths, patterns: [] });

		const target = resolveImport({ from, specifier, files, aliases });

		expect(target).toStrictEqual({ kind: 'file', path: expected });
	});

	test('takes the file over the folder barrel of the same name, in the order a bundler would', () => {
		const { from, files, aliases } = setupScope({
			paths: ['packages/engine/src/billing/widget.ts', 'packages/engine/src/billing/widget/index.ts'],
			patterns: [],
		});

		const target = resolveImport({ from, specifier: './widget', files, aliases });

		expect(target).toStrictEqual({ kind: 'file', path: 'packages/engine/src/billing/widget.ts' });
	});

	test('a relative path the run never listed is unknown, never a package — a relative specifier always meant a local file', () => {
		const { from, files, aliases } = setupScope({ paths: [], patterns: [] });

		const target = resolveImport({ from, specifier: './logo.svg', files, aliases });

		expect(target).toStrictEqual({ kind: 'unknown' });
	});

	test('resolves through the alias the package declares — the case that made every engine barrel look empty', () => {
		const { from, files, aliases } = setupScope({
			paths: ['packages/engine/src/agents/buildFeatureExecutorInvocation.ts'],
			patterns: [['@/*', ['./src/*']]],
		});

		const target = resolveImport({ from, specifier: '@/agents/buildFeatureExecutorInvocation', files, aliases });

		expect(target).toStrictEqual({ kind: 'file', path: 'packages/engine/src/agents/buildFeatureExecutorInvocation.ts' });
	});

	test('resolves an alias onto a folder barrel', () => {
		const { from, files, aliases } = setupScope({ paths: ['packages/engine/src/agents/index.ts'], patterns: [['@/*', ['./src/*']]] });

		const target = resolveImport({ from, specifier: '@/agents', files, aliases });

		expect(target).toStrictEqual({ kind: 'file', path: 'packages/engine/src/agents/index.ts' });
	});

	test('takes the longest matching prefix, the way TypeScript picks between overlapping patterns', () => {
		const { from, files, aliases } = setupScope({
			paths: ['packages/engine/generated/utils/formatRate.ts'],
			patterns: [
				['@/*', ['./src/*']],
				['@/utils/*', ['./generated/utils/*']],
			],
		});

		const target = resolveImport({ from, specifier: '@/utils/formatRate', files, aliases });

		expect(target).toStrictEqual({ kind: 'file', path: 'packages/engine/generated/utils/formatRate.ts' });
	});

	test('tries every target an alias names, in order', () => {
		const { from, files, aliases } = setupScope({
			paths: ['packages/engine/generated/formatRate.ts'],
			patterns: [['@/*', ['./src/*', './generated/*']]],
		});

		const target = resolveImport({ from, specifier: '@/formatRate', files, aliases });

		expect(target).toStrictEqual({ kind: 'file', path: 'packages/engine/generated/formatRate.ts' });
	});

	test('an alias that matches but lands on no file in scope is unknown, not a package', () => {
		const { from, files, aliases } = setupScope({ paths: [], patterns: [['@/*', ['./src/*']]] });

		const target = resolveImport({ from, specifier: '@/agents/missing', files, aliases });

		expect(target).toStrictEqual({ kind: 'unknown' });
	});

	test.each([{ specifier: 'zod' }, { specifier: 'node:path' }, { specifier: '@lightsout/standards-contracts' }])(
		'calls $specifier external when the aliases are known and none claims it',
		({ specifier }) => {
			const { from, files, aliases } = setupScope({ paths: [], patterns: [['@/*', ['./src/*']]] });

			const target = resolveImport({ from, specifier, files, aliases });

			expect(target).toStrictEqual({ kind: 'external' });
		},
	);

	test.each([
		{ kind: 'an alias', specifier: '@/agents/buildFeatureExecutorInvocation' },
		{ kind: 'a package', specifier: 'zod' },
	])('for $kind with no alias map, answers unknown rather than guessing — the two are written the same way', ({ specifier }) => {
		const { from, files } = setupScope({ paths: ['packages/engine/src/agents/buildFeatureExecutorInvocation.ts'] });

		const target = resolveImport({ from, specifier, files, aliases: undefined });

		expect(target).toStrictEqual({ kind: 'unknown' });
	});

	test('resolves a specifier that carries its own .ts extension, which allowImportingTsExtensions makes legal', () => {
		// the form Node's type stripping requires, and therefore the form every
		// standards package writes its own imports in
		const { from, files, aliases } = setupScope({ paths: ['packages/engine/src/billing/formatRate.ts'], patterns: [] });

		const target = resolveImport({ from, specifier: './formatRate.ts', files, aliases });

		expect(target).toStrictEqual({ kind: 'file', path: 'packages/engine/src/billing/formatRate.ts' });
	});

	test('resolves an aliased specifier carrying its own extension too', () => {
		const { from, files, aliases } = setupScope({ paths: ['packages/engine/src/agents/index.ts'], patterns: [['@/*', ['./src/*']]] });

		const target = resolveImport({ from, specifier: '@/agents/index.ts', files, aliases });

		expect(target).toStrictEqual({ kind: 'file', path: 'packages/engine/src/agents/index.ts' });
	});

	test.each([{ specifier: '~/formatRate' }, { specifier: '#internal/formatRate' }, { specifier: '@/formatRate' }])(
		'calls $specifier unknown rather than external — no package could be named that, so it is an alias this run cannot see',
		({ specifier }) => {
			// a bundler's own resolve.alias, or a jsconfig: the tsconfig does not
			// claim it, but it is still a local file
			const { from, files, aliases } = setupScope({ paths: [], patterns: [['@other/*', ['./src/*']]] });

			const target = resolveImport({ from, specifier, files, aliases });

			expect(target).toStrictEqual({ kind: 'unknown' });
		},
	);

	test.each([{ specifier: 'zod/v4' }, { specifier: 'lodash.merge' }, { specifier: '@lightsout/standards-contracts/dist' }])(
		'still calls $specifier external, since it is shaped like something installable',
		({ specifier }) => {
			const { from, files, aliases } = setupScope({ paths: [], patterns: [['@/*', ['./src/*']]] });

			const target = resolveImport({ from, specifier, files, aliases });

			expect(target).toStrictEqual({ kind: 'external' });
		},
	);
});
