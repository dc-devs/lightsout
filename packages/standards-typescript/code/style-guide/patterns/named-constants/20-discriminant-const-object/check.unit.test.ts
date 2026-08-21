import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupTypeCheckerInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

/** The const object and the interface that points at it — the shape the rule asks for. */
const family = (): Array<[string, string]> => [
	[
		'src/common/constants/SyncEventKind.ts',
		"export const SyncEventKind = {\n\tFileAdded: 'file-added',\n\tRecordParsed: 'record-parsed',\n} as const;\n\nexport type SyncEventKind = (typeof SyncEventKind)[keyof typeof SyncEventKind];\n",
	],
	[
		'src/common/types/SyncEvent.ts',
		"import type { SyncEventKind } from '../constants/SyncEventKind.ts';\n\nexport interface SyncEvent {\n\tkind: SyncEventKind;\n\tid: string;\n}\n",
	],
];

describe('discriminant-const-object check', () => {
	test('asks for a type checker, since whether a literal is a discriminant is decided by a declaration in another file', () => {
		expect(check.inputKind).toBe('type-checker');
	});

	test('reports a field typed as a raw string literal, and the line it sits on', async () => {
		const input = setupTypeCheckerInput({
			sources: [['src/common/types/SyncEvent.ts', "export interface FileAddedEvent {\n\tkind: 'file-added';\n\tpath: string;\n}\n"]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'discriminant-const-object:src/common/types/SyncEvent.ts',
				files: [{ path: 'src/common/types/SyncEvent.ts' }],
				detail: 'field typed as a raw string literal at line 2',
				guidance: "Reference the family's `const` object — `kind: typeof SyncEventKind.FileAdded`, and `SyncEventKind.FileAdded` at every narrowing site.",
			},
		]);
	});

	test('a field pointing at the const object is the shape the rule asks for', async () => {
		const input = setupTypeCheckerInput({ sources: family() });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('gathers every literal field of one file into one job', async () => {
		const input = setupTypeCheckerInput({
			sources: [['src/common/types/SyncEvent.ts', "export interface A {\n\tkind: 'a';\n}\n\nexport interface B {\n\tkind: 'b';\n}\n"]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe('field typed as a raw string literal at lines 2, 6');
	});

	test('a string literal outside a field is not a discriminant a consumer narrows on', async () => {
		// a union of literals declared as the family's own type, and a parameter
		// default — neither is a field, so neither leaks to a narrowing site
		const input = setupTypeCheckerInput({
			sources: [['src/common/types/Mode.ts', "export type Mode = 'fast' | 'slow';\n\nexport const run = (mode = 'fast'): string => mode;\n"]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('names the family a comparison retypes, in a file that never imports its const object', async () => {
		// This is what the checker buys. The file has nothing in scope to compare
		// the literal against — only the DECLARED type of `event.kind`, one import
		// away, says that 'file-added' is a member of a family.
		const input = setupTypeCheckerInput({
			sources: [
				...family(),
				[
					'src/sync/handle.ts',
					"import type { SyncEvent } from '../common/types/SyncEvent.ts';\n\nexport const handle = (event: SyncEvent): boolean => event.kind === 'file-added';\n",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'discriminant-const-object:src/sync/handle.ts',
				files: [{ path: 'src/sync/handle.ts' }],
				detail: 'SyncEventKind narrowed against a raw string literal at line 3',
				guidance: "Reference the family's `const` object — `kind: typeof SyncEventKind.FileAdded`, and `SyncEventKind.FileAdded` at every narrowing site.",
			},
		]);
	});

	test('a case clause is the same narrowing spelled the other way, and counts', async () => {
		const input = setupTypeCheckerInput({
			sources: [
				...family(),
				[
					'src/sync/route.ts',
					"import type { SyncEvent } from '../common/types/SyncEvent.ts';\n\nexport const route = (event: SyncEvent): string => {\n\tswitch (event.kind) {\n\t\tcase 'file-added':\n\t\t\treturn 'added';\n\t\tdefault:\n\t\t\treturn 'other';\n\t}\n};\n",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe('SyncEventKind narrowed against a raw string literal at line 5');
	});

	test('a plain string compared against the same literal is not a discriminant', async () => {
		// The literal is spelled exactly like a member of the family above, and
		// the family is in the run. What settles it is that `name` is declared
		// `string`: no declaration anywhere says this comparison is a narrowing.
		const input = setupTypeCheckerInput({
			sources: [...family(), ['src/sync/label.ts', "export const label = (name: string): string => (name === 'file-added' ? 'added' : 'other');\n"]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('a union with no const object behind it is a different rule\u2019s finding, not this one\u2019s', async () => {
		const input = setupTypeCheckerInput({
			sources: [
				['src/common/types/Mode.ts', "export type Mode = 'fast' | 'slow';\n"],
				['src/run/pace.ts', "import type { Mode } from '../common/types/Mode.ts';\n\nexport const pace = (mode: Mode): number => (mode === 'fast' ? 1 : 2);\n"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		// There is no member to reference. Declaring one is what
		// `bare-string-union` asks for, and this rule has nothing to say until it
		// exists.
		expect(findings).toStrictEqual([]);
	});

	test('a typeof guard is not a discriminant, though its type is a union of literals', async () => {
		const input = setupTypeCheckerInput({
			sources: [
				['src/common/constants/Shape.ts', "export const Shape = { Text: 'string' } as const;\n"],
				['src/run/read.ts', "export const read = (value: unknown): string => (typeof value === 'string' ? value : '');\n"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		// `typeof` types as the operator's own eight-member union, and the const
		// object above holds one of those strings by coincidence.
		expect(findings).toStrictEqual([]);
	});

	test('a rule check may not import a value from outside its own standards package, so its literal stands', async () => {
		const input = setupTypeCheckerInput({
			sources: [
				['src/common/constants/InputKind.ts', "export const InputKind = { FileList: 'file-list' } as const;\n"],
				[
					'standards/code/rules/05-example/check.ts',
					"import type { InputKind } from '../../../../src/common/constants/InputKind.ts';\n\nexport const run = (input: { kind: InputKind }): boolean => input.kind === 'file-list';\n",
				],
			],
			standardsPackages: ['standards'],
		});

		const findings = await check.run({ input, settings: {} });

		// A package ships as a bare directory with no node_modules, so every value
		// a check imports has to resolve inside it. The literal is not a choice.
		expect(findings).toStrictEqual([]);
	});

	test('a repo where nothing could be typed reports nothing rather than throwing', async () => {
		// What a repo with no tsconfig hands this check. The engine leaves such a
		// file out rather than typing it against the wrong options, so the check
		// has to answer about an empty set.
		const findings = await check.run({ input: setupTypeCheckerInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('answers nothing for an input kind it did not ask for', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
