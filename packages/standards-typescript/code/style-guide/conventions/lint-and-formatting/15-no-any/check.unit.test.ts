import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupSyntaxTreeInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

describe('no-any check', () => {
	test('asks for parsed trees, since only the tree tells the type keyword from the word', () => {
		expect(check.inputKind).toBe('syntax-tree');
	});

	test('reports an `any` annotation and the line it sits on', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/parsing/parseRecord.ts', 'export const parseRecord = ({ raw }: { raw: any }): string => String(raw);\n']],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'no-any:src/parsing/parseRecord.ts',
				files: [{ path: 'src/parsing/parseRecord.ts' }],
				detail: '`any` at line 1',
				guidance: 'Use `unknown` and narrow with a type guard, or name the type — a justified bypass needs the project’s lint-suppression comment.',
			},
		]);
	});

	test('gathers every annotation of one file into one job', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/parsing/parseRecord.ts',
					[
						'export const parseRecord = ({ raw }: { raw: any }): string => String(raw);',
						'',
						'export const parseList = (rows: any[]): number => rows.length;',
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe('`any` at lines 1, 3');
	});

	test.each([
		{ comment: '// biome-ignore lint/suspicious/noExplicitAny: the vendor callback is untyped', tool: 'biome' },
		{ comment: '// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the vendor callback is untyped', tool: 'eslint' },
		{ comment: '// @ts-ignore the vendor callback is untyped', tool: 'a TypeScript directive' },
	])('accepts an annotation the line above suppresses with $tool', async ({ comment }) => {
		const input = setupSyntaxTreeInput({
			sources: [['src/parsing/parseRecord.ts', [comment, 'export const parseRecord = ({ raw }: { raw: any }): string => String(raw);'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('accepts an annotation suppressed on its own line', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/parsing/parseRecord.ts', 'export const parseRecord = ({ raw }: { raw: any }): string => String(raw); // biome-ignore lint: vendor\n']],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a file that narrows from `unknown` instead', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/parsing/parseRecord.ts', 'export const parseRecord = ({ raw }: { raw: unknown }): string => String(raw);\n']],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves the word alone where it is a name rather than the type keyword', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/parsing/parseRecord.ts', "export const parseRecord = (): string => {\n\tconst any = 'anything';\n\n\treturn any;\n};\n"]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports each offending file on its own and passes over the files that are clean', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/parsing/parseLegacyRecord.ts', 'export const parseLegacyRecord = ({ raw }: { raw: unknown }): string => String(raw);\n'],
				['src/parsing/parseRecord.ts', 'export const parseRecord = ({ raw }: { raw: any }): string => String(raw);\n'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'no-any:src/parsing/parseRecord.ts',
				files: [{ path: 'src/parsing/parseRecord.ts' }],
				detail: '`any` at line 1',
				guidance: 'Use `unknown` and narrow with a type guard, or name the type — a justified bypass needs the project’s lint-suppression comment.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
