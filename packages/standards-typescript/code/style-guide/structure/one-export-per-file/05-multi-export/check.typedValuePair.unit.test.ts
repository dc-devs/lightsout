import { describe, expect, test } from '@jest/globals';
import type { StandardsCheckInput } from '@lightsout/standards-contracts';
import { StandardsInputKind } from '@lightsout/standards-contracts';
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

describe('multi-export check — the typed-value pair (exception 5)', () => {
	test('a type and the single value typed by it share a file — exception 5', async () => {
		const input = setupFileTextInput({
			contents: [
				[
					'src/common/constants/defaultConfig.ts',
					['export interface Config {', '\tname: string;', '}', '', "export const defaultConfig: Config = { name: 'default' };"].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('a const not annotated with the co-located type is not the typed-value pair', async () => {
		const input = setupFileTextInput({
			contents: [['src/common/types/Theme.ts', ['export interface Theme {', '\tname: string;', '}', '', "export const defaultName = 'dark';"].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toHaveLength(1);
	});

	test('a type with two typed values is past the pair and reports', async () => {
		const input = setupFileTextInput({
			contents: [
				[
					'src/common/constants/themes.ts',
					[
						'export interface Theme {',
						'\tname: string;',
						'}',
						'',
						"export const darkTheme: Theme = { name: 'dark' };",
						"export const lightTheme: Theme = { name: 'light' };",
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toHaveLength(1);
	});
});
