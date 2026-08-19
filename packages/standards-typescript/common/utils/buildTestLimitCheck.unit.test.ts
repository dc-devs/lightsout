import { describe, expect, test } from '@jest/globals';
import { setupTestFileInput } from '@lightsout/standards-testkit';
import { buildTestLimitCheck } from './buildTestLimitCheck.ts';

const check = buildTestLimitCheck({
	rule: 'demo-limit',
	setting: 'maxLines',
	// Reports a file over the limit by its line count — the one part such rules differ in.
	report: ({ file, text, limit }) => {
		const lines = text.split('\n').length;

		return lines > limit ? { files: [{ path: file }], detail: `${lines} lines (cap ${limit})` } : undefined;
	},
	guidance: 'the remedy line',
});

describe('buildTestLimitCheck', () => {
	test('asks for test files, resolves the named setting, and reports what the measurement returns', async () => {
		expect(check.inputKind).toBe('test-file');

		const input = setupTestFileInput({
			contents: [
				['src/long.unit.test.ts', 'a\nb\nc\nd'],
				['src/short.unit.test.ts', 'a\nb'],
			],
		});

		expect(await check.run({ input, settings: { maxLines: 3 } })).toStrictEqual([
			{ siteKey: 'demo-limit:src/long.unit.test.ts', files: [{ path: 'src/long.unit.test.ts' }], detail: '4 lines (cap 3)', guidance: 'the remedy line' },
		]);
	});

	test('a file inside the limit contributes nothing', async () => {
		const input = setupTestFileInput({ contents: [['src/fits.unit.test.ts', 'a\nb\nc']] });

		expect(await check.run({ input, settings: { maxLines: 3 } })).toStrictEqual([]);
	});
});
