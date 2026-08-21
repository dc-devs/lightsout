import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupSyntaxTreeInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

describe('discriminant-const-object check', () => {
	test('asks for parsed trees, since a literal in a type position and a default value read the same', () => {
		expect(check.inputKind).toBe('syntax-tree');
	});

	test('reports a field typed as a raw string literal, and the line it sits on', async () => {
		const input = setupSyntaxTreeInput({
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
		const input = setupSyntaxTreeInput({
			sources: [['src/common/types/SyncEvent.ts', 'export interface FileAddedEvent {\n\tkind: typeof SyncEventKind.FileAdded;\n}\n']],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('gathers every literal field of one file into one job', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/common/types/SyncEvent.ts', "export interface A {\n\tkind: 'a';\n}\n\nexport interface B {\n\tkind: 'b';\n}\n"]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe('field typed as a raw string literal at lines 2, 6');
	});

	test('a string literal outside a field is not a discriminant a consumer narrows on', async () => {
		// a union of literals declared as the family's own type, and a parameter
		// default — neither is a field, so neither leaks to a narrowing site
		const input = setupSyntaxTreeInput({
			sources: [['src/common/types/Mode.ts', "export type Mode = 'fast' | 'slow';\n\nexport const run = (mode = 'fast'): string => mode;\n"]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('a field compared against a literal the const object in scope already holds is the narrowing half of the rule', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/common/constants/SyncEventKind.ts', "export const SyncEventKind = {\n\tFileAdded: 'file-added',\n} as const;\n"],
				[
					'src/sync/handle.ts',
					"import { SyncEventKind } from '../common/constants/SyncEventKind';\n\nexport const handle = (event: { kind: string }): boolean => event.kind === 'file-added';\n",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'discriminant-const-object:src/sync/handle.ts',
				files: [{ path: 'src/sync/handle.ts' }],
				detail: 'discriminant compared against a raw string literal at line 3',
				guidance: "Reference the family's `const` object — `kind: typeof SyncEventKind.FileAdded`, and `SyncEventKind.FileAdded` at every narrowing site.",
			},
		]);
	});

	test('a literal matching some unrelated object elsewhere is not a retyped discriminant — the object must be in scope', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/common/constants/SyncEventKind.ts', "export const SyncEventKind = {\n\tFileAdded: 'file-added',\n} as const;\n"],
				// no import of the object: this file cannot be retyping what it cannot reach
				['src/sync/other.ts', "export const other = (event: { kind: string }): boolean => event.kind === 'file-added';\n"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('answers nothing for an input kind it did not ask for', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
