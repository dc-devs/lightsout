import { describe, expect, test } from '@jest/globals';
import { setupFileTextInput } from '@lightsout/standards-testkit';
import { buildFileExportCheck } from './buildFileExportCheck.ts';

const check = buildFileExportCheck({
	rule: 'demo-exports',
	// Flags any file declaring more than one export — judgment enough to see the shared half work.
	detail: ({ exports }) => (exports.length > 1 ? `${exports.length} exports` : undefined),
	guidance: 'the remedy line',
});

describe('buildFileExportCheck', () => {
	test('asks for file text, and reports one finding per violating file in the rule’s own words', async () => {
		expect(check.inputKind).toBe('file-text');

		const input = setupFileTextInput({
			contents: [
				['src/pair.ts', 'export const one = 1;\nexport const two = 2;\n'],
				['src/single.ts', 'export const only = 1;\n'],
			],
		});

		expect(await check.run({ input, settings: {} })).toStrictEqual([
			{ siteKey: 'demo-exports:src/pair.ts', files: [{ path: 'src/pair.ts' }], detail: '2 exports', guidance: 'the remedy line' },
		]);
	});

	test("a rule's own exemption is asked once for the run, and the files it names go unjudged", async () => {
		const exempting = buildFileExportCheck({
			rule: 'demo-exports',
			detail: ({ exports }) => (exports.length > 1 ? `${exports.length} exports` : undefined),
			guidance: 'the remedy line',
			getExempt: ({ files }) => new Set(files.filter((file) => file.startsWith('src/routes/'))),
		});
		const input = setupFileTextInput({
			contents: [
				['src/routes/pair.ts', 'export const one = 1;\nexport const two = 2;\n'],
				['src/pair.ts', 'export const one = 1;\nexport const two = 2;\n'],
			],
		});

		expect(await exempting.run({ input, settings: {} })).toStrictEqual([
			{ siteKey: 'demo-exports:src/pair.ts', files: [{ path: 'src/pair.ts' }], detail: '2 exports', guidance: 'the remedy line' },
		]);
	});

	test('a barrel and a test file are exempt — one declares nothing of its own, the other belongs to the test standards', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/feature/index.ts', "export { one } from './one';\nexport { two } from './two';\n"],
				['src/feature/one.unit.test.ts', 'export const helperA = 1;\nexport const helperB = 2;\n'],
			],
		});

		expect(await check.run({ input, settings: {} })).toStrictEqual([]);
	});
});
