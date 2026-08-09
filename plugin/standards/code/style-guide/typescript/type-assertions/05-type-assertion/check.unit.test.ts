import { expect, describe, test } from '@jest/globals';
import type ts from 'typescript';
import { resolveConsumerTypescript } from '@/common/utils/resolveConsumerTypescript';
import { StandardsInputKind } from '@/contracts';
import type { StandardsCheckInput } from '@/contracts';
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

	return { kind: StandardsInputKind.SyntaxTree, cwd: '/repo', source: paths, tests: [], files: paths, referenceFiles: [], compiler, trees };
};

/** The input a rule that did NOT declare `syntax-tree` would receive — an arm the union permits but a run never produces. */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/payloads/readLabel.ts'],
	spans: [],
});

describe('type-assertion check', () => {
	test('asks for parsed trees, since only the tree tells a cast from the word `as`', () => {
		expect(check.inputKind).toBe('syntax-tree');
	});

	test('reports a cast to a keyword type and the line it sits on', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/payloads/readLabel.ts', 'export const readLabel = ({ payload }: { payload: Record<string, unknown> }): string => (payload.label as string).toUpperCase();\n']],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'type-assertion:src/payloads/readLabel.ts',
				files: [{ path: 'src/payloads/readLabel.ts' }],
				detail: '`as` cast at line 1',
				guidance: 'Narrow with `typeof`, `instanceof` or a discriminated union — an assertion that is genuinely unavoidable needs a comment saying why.',
			},
		]);
	});

	test('reports a cast to a named type, which is a reference to something other than `const`', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/payloads/readKind.ts', ["import type { PayloadKind } from './common/constants/PayloadKind.ts';", '', 'export const readKind = ({ raw }: { raw: unknown }): PayloadKind => raw as PayloadKind;'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe('`as` cast at line 3');
	});

	test('reports a cast to a type read off another namespace, where the name is qualified rather than plain', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/payloads/readNode.ts', "import type ts from 'typescript';\n\nexport const readNode = ({ raw }: { raw: unknown }): ts.Node => raw as ts.Node;\n"]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe('`as` cast at line 3');
	});

	test('reaches a cast buried inside a function body rather than only the ones at the top', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/payloads/readLabel.ts',
					['export const readLabel = ({ payload }: { payload: Record<string, unknown> }): string => {', '\tconst label = payload.label as string;', '', '\treturn label.toUpperCase();', '};'].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe('`as` cast at line 2');
	});

	test('gathers every cast of one file into one job, since one pass proves the types it works with', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/payloads/readLabel.ts',
					['export const readLabel = ({ payload }: { payload: Record<string, unknown> }): string => (payload.label as string).toUpperCase();', '', 'export const readCount = ({ payload }: { payload: Record<string, unknown> }): number => payload.count as number;'].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'type-assertion:src/payloads/readLabel.ts',
				files: [{ path: 'src/payloads/readLabel.ts' }],
				detail: '`as` cast at lines 1, 3',
				guidance: 'Narrow with `typeof`, `instanceof` or a discriminated union — an assertion that is genuinely unavoidable needs a comment saying why.',
			},
		]);
	});

	test('counts both halves of a double cast, since each one is an assertion of its own', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/payloads/readLabel.ts', 'export const readLabel = ({ payload }: { payload: Record<string, unknown> }): string => payload.label as unknown as string;\n']],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe('`as` cast at lines 1, 1');
	});

	test('leaves an `as const`, which freezes literals rather than asserting a type', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/payloads/common/constants/PayloadKind.ts',
					['export const PayloadKind = {', "\tLabel: 'label',", "\tAmount: 'amount',", '} as const;', '', 'export type PayloadKind = (typeof PayloadKind)[keyof typeof PayloadKind];'].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a file that narrows with `typeof` instead of asserting', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/payloads/readLabel.ts',
					[
						'export const readLabel = ({ payload }: { payload: Record<string, unknown> }): string => {',
						'\tconst label = payload.label;',
						'',
						"\treturn typeof label === 'string' ? label.toUpperCase() : '';",
						'};',
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves the word alone where it renames an import rather than casting', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/payloads/readLabel.ts', "import { readLabel as readPayloadLabel } from './common/utils/readLabel.ts';\n\nexport const read = ({ payload }: { payload: Record<string, unknown> }): string => readPayloadLabel({ payload });\n"]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves the word alone where it sits in a string or a comment', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/payloads/readLabel.ts', "// treat the value as a label\nexport const readLabel = (): string => 'as string';\n"]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports each offending file on its own and passes over the files that are clean', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/payloads/readAmount.ts', 'export const readAmount = ({ payload }: { payload: Record<string, unknown> }): number => (typeof payload.amount === \'number\' ? payload.amount : 0);\n'],
				['src/payloads/readLabel.ts', 'export const readLabel = ({ payload }: { payload: Record<string, unknown> }): string => (payload.label as string).toUpperCase();\n'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'type-assertion:src/payloads/readLabel.ts',
				files: [{ path: 'src/payloads/readLabel.ts' }],
				detail: '`as` cast at line 1',
				guidance: 'Narrow with `typeof`, `instanceof` or a discriminated union — an assertion that is genuinely unavoidable needs a comment saying why.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
