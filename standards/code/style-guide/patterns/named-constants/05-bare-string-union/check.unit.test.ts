import { describe, expect, test } from '@jest/globals';
import type ts from 'typescript';
import { resolveConsumerTypescript } from '@/common/utils/resolveConsumerTypescript';
import type { StandardsCheckInput } from '@/contracts';
import { StandardsInputKind } from '@/contracts';
import { check } from './check.ts';

/** A repo as the engine hands it to a syntax-tree rule: one parsed tree per source file, plus the compiler it borrowed. */
const setupSyntaxTreeInput = ({ sources }: { sources: Array<[string, string]> }): StandardsCheckInput => {
	const compiler = resolveConsumerTypescript({ cwd: process.cwd() });

	if (compiler === undefined) {
		throw new Error('the repo running this suite must have a typescript to borrow');
	}

	const trees = new Map<string, ts.SourceFile>();

	for (const [path, text] of sources) {
		trees.set(path, compiler.createSourceFile(path, text, compiler.ScriptTarget.Latest, true));
	}

	const paths = sources.map(([path]) => path);

	return {
		kind: StandardsInputKind.SyntaxTree,
		cwd: '/repo',
		source: paths,
		tests: [],
		files: paths,
		referenceFiles: [],
		standardsPackages: [],
		compiler,
		trees,
	};
};

/** The input a rule that did NOT declare `syntax-tree` would receive — an arm the union permits but a run never produces. */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/common/types/Action.ts'],
	spans: [],
});

describe('bare-string-union check', () => {
	test('asks for parsed trees, since only the declaration says which shape was written', () => {
		expect(check.inputKind).toBe('syntax-tree');
	});

	test('reports an exported union of string literals with no object behind it', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/common/types/Action.ts', "export type Action = 'add' | 'remove' | 'list' | 'update';\n"]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'bare-string-union:src/common/types/Action.ts',
				files: [{ path: 'src/common/types/Action.ts' }],
				detail: "type 'Action' is a bare string union",
				guidance: 'Declare the values as an `as const` object and derive the union from it, so consumers reference members instead of literals.',
			},
		]);
	});

	test('leaves a union derived from an `as const` object of the same name', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/common/constants/Action.ts',
					[
						'export const Action = {',
						"\tAdd: 'add',",
						"\tRemove: 'remove',",
						"\tList: 'list',",
						"\tUpdate: 'update',",
						'} as const;',
						'',
						'export type Action = (typeof Action)[keyof typeof Action];',
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a literal union whose object sits beside it, even when the union is written out', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/common/constants/Action.ts',
					["export const Action = { Add: 'add', Remove: 'remove' } as const;", '', "export type Action = 'add' | 'remove';"].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test.each([
		{ shape: 'a lone literal, which is no union at all', text: "export type Action = 'add';" },
		{ shape: 'a union mixing a literal with a wide type', text: "export type Action = 'add' | string;" },
		{ shape: 'a union of numbers rather than strings', text: 'export type Action = 1 | 2;' },
	])('leaves $shape', async ({ text }) => {
		const input = setupSyntaxTreeInput({ sources: [['src/common/types/Action.ts', `${text}\n`]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a bare union the file keeps to itself, since no other file can retype its literals', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/common/types/Action.ts', "type Action = 'add' | 'remove';\n\nexport const isAdd = (action: Action): boolean => action === 'add';\n"]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports a union whose same-named binding is reassignable, since only a `const` can be the source of truth', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/common/types/Action.ts', ["let Action = { Add: 'add' };", '', "export type Action = 'add' | 'remove';"].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.siteKey).toBe('bare-string-union:src/common/types/Action.ts');
	});

	test('reports a union whose same-named binding was destructured rather than declared', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/common/types/Action.ts',
					["import { registry } from './registry.ts';", '', 'const { Action } = registry;', '', "export type Action = 'add' | 'remove';"].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("type 'Action' is a bare string union");
	});

	test('gathers every bare union of one file into one job, since one edit fixes them together', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/common/types/Action.ts', ["export type Action = 'add' | 'remove';", '', "export type Scope = 'file' | 'folder';"].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'bare-string-union:src/common/types/Action.ts',
				files: [{ path: 'src/common/types/Action.ts' }],
				detail: "type 'Action' is a bare string union; type 'Scope' is a bare string union",
				guidance: 'Declare the values as an `as const` object and derive the union from it, so consumers reference members instead of literals.',
			},
		]);
	});

	test('reports each offending file on its own and passes over the files that are clean', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/common/constants/Scope.ts',
					["export const Scope = { File: 'file' } as const;", '', 'export type Scope = (typeof Scope)[keyof typeof Scope];'].join('\n'),
				],
				['src/common/types/Action.ts', "export type Action = 'add' | 'remove';\n"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'bare-string-union:src/common/types/Action.ts',
				files: [{ path: 'src/common/types/Action.ts' }],
				detail: "type 'Action' is a bare string union",
				guidance: 'Declare the values as an `as const` object and derive the union from it, so consumers reference members instead of literals.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
