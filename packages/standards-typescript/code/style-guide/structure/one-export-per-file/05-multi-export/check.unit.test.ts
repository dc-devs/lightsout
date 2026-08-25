import { describe, expect, test } from '@jest/globals';
import type { StandardsCheckInput } from '@lightsout/standards-contracts';
import { StandardsInputKind } from '@lightsout/standards-contracts';
import { setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

/**
 * A repo as the engine hands it to a file-text rule: every path in scope, with
 * its text. `listedWithoutText` names paths the run found but never read, so a
 * file can appear in scope with no contents entry behind it.
 */
const setupFileTextInput = ({ contents, listedWithoutText = [] }: { contents: Array<[string, string]>; listedWithoutText?: string[] }): StandardsCheckInput => {
	const files = [...contents.map(([path]) => path), ...listedWithoutText];

	return {
		kind: StandardsInputKind.FileText,
		cwd: '/repo',
		source: files,
		tests: [],
		files,
		referenceFiles: [],
		contents: new Map(contents),
		standardsPacks: [],
	};
};

describe('multi-export check', () => {
	test('asks for file text, since the verdict is in each file’s own declaration lines', () => {
		expect(check.inputKind).toBe('file-text');
	});

	test('reports a file holding two unrelated exports, naming both', async () => {
		const input = setupFileTextInput({
			contents: [['src/common/types/Config.ts', ['export interface Config {', '\tname: string;', '}', '', 'export const maxRetries = 3;'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'multi-export:src/common/types/Config.ts',
				files: [{ path: 'src/common/types/Config.ts' }],
				detail: '2 exports (Config, maxRetries)',
				guidance: 'One export per file, outside the closed exception list.',
			},
		]);
	});

	test('judges each file on its own, so one crowded file does not tar its neighbour', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/billing/rate.ts', ['export const baseRate = 1;', 'export const taxRate = 2;'].join('\n')],
				['src/billing/applyRate.ts', 'export const applyRate = (): number => 1;'],
				['src/sync/pushBatch.ts', ['export class PushBatch {}', 'export enum PushState {}', 'export function pushBatch(): void {}'].join('\n')],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'multi-export:src/billing/rate.ts',
				files: [{ path: 'src/billing/rate.ts' }],
				detail: '2 exports (baseRate, taxRate)',
				guidance: 'One export per file, outside the closed exception list.',
			},
			{
				siteKey: 'multi-export:src/sync/pushBatch.ts',
				files: [{ path: 'src/sync/pushBatch.ts' }],
				detail: '3 exports (PushBatch, PushState, pushBatch)',
				guidance: 'One export per file, outside the closed exception list.',
			},
		]);
	});

	test('counts an exported async function, whose declaration carries a keyword before the kind', async () => {
		const input = setupFileTextInput({
			contents: [['src/sync/fetchBatch.ts', ['export async function fetchBatch(): Promise<void> {}', 'export const batchSize = 10;'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'multi-export:src/sync/fetchBatch.ts',
				files: [{ path: 'src/sync/fetchBatch.ts' }],
				detail: '2 exports (fetchBatch, batchSize)',
				guidance: 'One export per file, outside the closed exception list.',
			},
		]);
	});

	test('leaves a file holding a single export alone — the whole point of the rule', async () => {
		const input = setupFileTextInput({
			contents: [['src/common/types/Config.ts', ['export interface Config {', '\tname: string;', '}'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a file that exports nothing at all alone', async () => {
		const input = setupFileTextInput({
			contents: [['src/sync/runSync.ts', ['const step = 1;', 'const total = 2;'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reads a listed file the run never captured text for as exporting nothing', async () => {
		const input = setupFileTextInput({
			contents: [],
			listedWithoutText: ['src/common/types/Config.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('exempts a union family: member interfaces plus the one alias built from them', async () => {
		const input = setupFileTextInput({
			contents: [
				[
					'src/common/types/SyncEvent.ts',
					[
						'export interface FileAddedEvent {',
						"\tkind: 'file-added';",
						'}',
						'',
						'export interface RecordParsedEvent {',
						"\tkind: 'record-parsed';",
						'}',
						'',
						'export type SyncEvent = FileAddedEvent | RecordParsedEvent;',
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports member interfaces carrying a second alias, which is two families in one file', async () => {
		const input = setupFileTextInput({
			contents: [
				[
					'src/common/types/SyncEvent.ts',
					[
						'export interface FileAddedEvent {',
						"\tkind: 'file-added';",
						'}',
						'',
						'export type SyncEvent = FileAddedEvent;',
						"export type SyncEventKind = SyncEvent['kind'];",
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'multi-export:src/common/types/SyncEvent.ts',
				files: [{ path: 'src/common/types/SyncEvent.ts' }],
				detail: '3 exports (FileAddedEvent, SyncEvent, SyncEventKind)',
				guidance: 'One export per file, outside the closed exception list.',
			},
		]);
	});

	test('reports member interfaces sharing the file with an unrelated constant, alias or no alias', async () => {
		const input = setupFileTextInput({
			contents: [
				[
					'src/common/types/SyncEvent.ts',
					[
						'export interface FileAddedEvent {',
						"\tkind: 'file-added';",
						'}',
						'',
						'export type SyncEvent = FileAddedEvent;',
						"export const defaultEvent = 'file-added';",
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'multi-export:src/common/types/SyncEvent.ts',
				files: [{ path: 'src/common/types/SyncEvent.ts' }],
				detail: '3 exports (FileAddedEvent, SyncEvent, defaultEvent)',
				guidance: 'One export per file, outside the closed exception list.',
			},
		]);
	});

	test('reports interfaces with no alias at all — a plain pile of types, not a union family', async () => {
		const input = setupFileTextInput({
			contents: [
				[
					'src/common/types/SyncEvent.ts',
					['export interface FileAddedEvent {', "\tkind: 'file-added';", '}', '', 'export interface RecordParsedEvent {', "\tkind: 'record-parsed';", '}'].join(
						'\n',
					),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'multi-export:src/common/types/SyncEvent.ts',
				files: [{ path: 'src/common/types/SyncEvent.ts' }],
				detail: '2 exports (FileAddedEvent, RecordParsedEvent)',
				guidance: 'One export per file, outside the closed exception list.',
			},
		]);
	});

	test('exempts a named constant and the union derived from it', async () => {
		const input = setupFileTextInput({
			contents: [
				[
					'src/common/constants/SyncState.ts',
					["export const SyncState = { idle: 'idle', busy: 'busy' } as const;", '', 'export type SyncState = (typeof SyncState)[keyof typeof SyncState];'].join(
						'\n',
					),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('exempts a lookup map keyed by that same union, which is coupled to both', async () => {
		const input = setupFileTextInput({
			contents: [
				[
					'src/common/constants/SyncState.ts',
					[
						"export const SyncState = { idle: 'idle', busy: 'busy' } as const;",
						'',
						'export type SyncState = (typeof SyncState)[keyof typeof SyncState];',
						'',
						"export const syncStateLabels: Record<SyncState, string> = { idle: 'Idle', busy: 'Busy' };",
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports a named constant whose file also holds a constant keyed by nothing', async () => {
		const input = setupFileTextInput({
			contents: [
				[
					'src/common/constants/SyncState.ts',
					[
						"export const SyncState = { idle: 'idle', busy: 'busy' } as const;",
						'',
						'export type SyncState = (typeof SyncState)[keyof typeof SyncState];',
						'',
						'export const retryLimit = 3;',
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'multi-export:src/common/constants/SyncState.ts',
				files: [{ path: 'src/common/constants/SyncState.ts' }],
				detail: '3 exports (SyncState, SyncState, retryLimit)',
				guidance: 'One export per file, outside the closed exception list.',
			},
		]);
	});

	test('reports a named constant whose file also holds an interface, which no lookup-map exemption covers', async () => {
		const input = setupFileTextInput({
			contents: [
				[
					'src/common/constants/SyncState.ts',
					[
						"export const SyncState = { idle: 'idle', busy: 'busy' } as const;",
						'',
						'export type SyncState = (typeof SyncState)[keyof typeof SyncState];',
						'',
						'export interface SyncOptions {',
						'\tretries: number;',
						'}',
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'multi-export:src/common/constants/SyncState.ts',
				files: [{ path: 'src/common/constants/SyncState.ts' }],
				detail: '3 exports (SyncState, SyncState, SyncOptions)',
				guidance: 'One export per file, outside the closed exception list.',
			},
		]);
	});

	test('reads a generator’s interpolated export line as the string it sits in, not a declaration', async () => {
		const input = setupFileTextInput({
			contents: [
				[
					'tools/generateBarrels.ts',
					['export const generateBarrels = (exportName: string): string => `', "export const ${exportName}: string = '';", '`;'].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test.each([
		{ shape: 'named for a test', path: 'src/billing/rate.unit.test.ts' },
		{ shape: 'sitting under a test directory', path: 'tests/helpers/rate.ts' },
	])('spares a file $shape, which the code standards leave to the test standards', async ({ path }) => {
		const input = setupFileTextInput({
			contents: [[path, ['export const baseRate = 1;', 'export const taxRate = 2;'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('spares a barrel, whose job is to list what the module exports', async () => {
		const input = setupFileTextInput({
			contents: [['src/billing/index.ts', ['export const baseRate = 1;', 'export const taxRate = 2;'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
