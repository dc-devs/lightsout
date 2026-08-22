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

	test('a rule check may not import a value from outside its own standards pack, so its literal stands', async () => {
		const input = setupTypeCheckerInput({
			sources: [
				['src/common/constants/InputKind.ts', "export const InputKind = { FileList: 'file-list' } as const;\n"],
				[
					'standards/code/rules/05-example/check.ts',
					"import type { InputKind } from '../../../../src/common/constants/InputKind.ts';\n\nexport const run = (input: { kind: InputKind }): boolean => input.kind === 'file-list';\n",
				],
			],
			standardsPacks: ['standards'],
		});

		const findings = await check.run({ input, settings: {} });

		// A package ships as a bare directory with no node_modules, so every value
		// a check imports has to resolve inside it. The literal is not a choice.
		expect(findings).toStrictEqual([]);
	});

	test('a check narrowing against a const object inside its own standards pack is reported, since it may import it', async () => {
		// The other half of the reachability question: the family is declared in
		// the pack the check lives in, so referencing it costs the check nothing
		// and the spelled-out literal is a choice. The identical string declared
		// outside the pack is beside the point.
		const input = setupTypeCheckerInput({
			sources: [
				[
					'standards/common/constants/RuleKind.ts',
					"export const RuleKind = {\n\tFileList: 'file-list',\n\tFileText: 'file-text',\n} as const;\n\nexport type RuleKind = (typeof RuleKind)[keyof typeof RuleKind];\n",
				],
				['src/common/constants/InputKind.ts', "export const InputKind = { FileList: 'file-list' } as const;\n"],
				[
					'standards/code/rules/05-example/check.ts',
					"import type { RuleKind } from '../../../common/constants/RuleKind.ts';\n\nexport const run = (rule: { kind: RuleKind }): boolean => rule.kind === 'file-list';\n",
				],
			],
			standardsPacks: ['standards'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'discriminant-const-object:standards/code/rules/05-example/check.ts',
				files: [{ path: 'standards/code/rules/05-example/check.ts' }],
				detail: 'RuleKind narrowed against a raw string literal at line 3',
				guidance: "Reference the family's `const` object — `kind: typeof SyncEventKind.FileAdded`, and `SyncEventKind.FileAdded` at every narrowing site.",
			},
		]);
	});

	test('a source path the engine could not type is passed over, and the rest of the run still reports', async () => {
		const input = setupTypeCheckerInput({
			sources: [['src/common/types/SyncEvent.ts', "export interface FileAddedEvent {\n\tkind: 'file-added';\n}\n"]],
			source: ['src/common/types/Missing.ts', 'src/common/types/SyncEvent.ts'],
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

	test('an inequality retypes the literal exactly as an equality does, and counts', async () => {
		const input = setupTypeCheckerInput({
			sources: [
				...family(),
				[
					'src/sync/skip.ts',
					"import type { SyncEvent } from '../common/types/SyncEvent.ts';\n\nexport const skip = (event: SyncEvent): boolean => event.kind !== 'file-added';\n",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe('SyncEventKind narrowed against a raw string literal at line 3');
	});

	test('the literal counts on either side of the comparison', async () => {
		const input = setupTypeCheckerInput({
			sources: [
				...family(),
				[
					'src/sync/isAdded.ts',
					"import type { SyncEvent } from '../common/types/SyncEvent.ts';\n\nexport const isAdded = (event: SyncEvent): boolean => 'file-added' === event.kind;\n",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe('SyncEventKind narrowed against a raw string literal at line 3');
	});

	test('a comparison of two fields, and a literal joined by a non-equality operator, are not narrowing sites', async () => {
		const input = setupTypeCheckerInput({
			sources: [
				...family(),
				[
					'src/sync/compare.ts',
					"import type { SyncEvent } from '../common/types/SyncEvent.ts';\n\nexport const same = (a: SyncEvent, b: SyncEvent): boolean => a.kind === b.kind;\n\nexport const label = (event: SyncEvent): string => event.kind + '-done';\n",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('only a string-valued property of an `as const` object literal puts a member in the run', async () => {
		// Everything here spells `as const` or holds the string, and none of it
		// declares a family a narrowing site could reference instead.
		const input = setupTypeCheckerInput({
			sources: [
				[
					'src/common/constants/Odd.ts',
					"const base = { Loose: 'file-added' };\n\nexport const Counts = { Retries: 3 } as const;\n\nexport const Modes = ['file-added'] as const;\n\nexport const Spread = { ...base } as const;\n\nexport let pending;\n",
				],
				['src/sync/handle.ts', "export const handle = (kind: 'file-added' | 'record-parsed'): boolean => kind === 'file-added';\n"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('a field typed as anything but a string literal is not the declaration half', async () => {
		const input = setupTypeCheckerInput({
			sources: [['src/common/types/Job.ts', 'export interface Job {\n\tretries: 3;\n\tname: string;\n\tkind;\n}\n']],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('names a family with no alias by its printed type, and reports both halves of one file as one job', async () => {
		const input = setupTypeCheckerInput({
			sources: [...family(), ['src/sync/peek.ts', "export const peek = (event: { kind: 'file-added' }): boolean => event.kind === 'file-added';\n"]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe('field typed as a raw string literal at line 1; "file-added" narrowed against a raw string literal at line 1');
	});

	test('a type that is not wholly string literals, and a literal the family does not admit, are not narrowings', async () => {
		// `stray` compares against a literal outside its own type — code the
		// compiler already rejects. What matters is that this check does not add
		// a second, wrong complaint on top of that one.
		const input = setupTypeCheckerInput({
			sources: [
				...family(),
				['src/sync/mixed.ts', "export const mixed = (kind: 'file-added' | 1): boolean => kind === 'file-added';\n"],
				['src/sync/stray.ts', "export const stray = (mode: 'fast' | 'slow'): boolean => mode === 'file-added';\n"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('a switch already referencing the const object is the shape the rule asks for', async () => {
		const input = setupTypeCheckerInput({
			sources: [
				...family(),
				[
					'src/sync/dispatch.ts',
					"import { SyncEventKind } from '../common/constants/SyncEventKind.ts';\nimport type { SyncEvent } from '../common/types/SyncEvent.ts';\n\nexport const dispatch = (event: SyncEvent): string => {\n\tswitch (event.kind) {\n\t\tcase SyncEventKind.FileAdded:\n\t\t\treturn 'added';\n\t\tdefault:\n\t\t\treturn 'other';\n\t}\n};\n",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

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
