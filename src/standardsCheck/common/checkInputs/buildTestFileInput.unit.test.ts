import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { buildTestFileInput } from '@/standardsCheck/common/checkInputs/buildTestFileInput';

const setupRepo = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-test-file-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/alpha.ts'), 'export const alpha = 1;\n');
	writeFileSync(join(cwd, 'src/alpha.unit.test.ts'), "test('alpha', () => {});\n");

	return { cwd };
};

describe('buildTestFileInput', () => {
	test('holds the test files and their text, and nothing else', async () => {
		const { cwd } = setupRepo();
		const cache = new Map<string, string>();

		const input = await buildTestFileInput({ cwd, tests: ['src/alpha.unit.test.ts'], cache });

		expect(input.kind).toBe('test-file');
		expect(input.tests).toStrictEqual(['src/alpha.unit.test.ts']);
		expect(input.contents.get('src/alpha.unit.test.ts')).toBe("test('alpha', () => {});\n");
		// the source file is in the run's cache but not in this input
		expect(input.contents.has('src/alpha.ts')).toBe(false);
	});

	test('reads through the run cache rather than opening a file a previous kind already read', async () => {
		const { cwd } = setupRepo();
		const cache = new Map<string, string>([['src/alpha.unit.test.ts', 'text from the first reader']]);

		const input = await buildTestFileInput({ cwd, tests: ['src/alpha.unit.test.ts'], cache });

		expect(input.contents.get('src/alpha.unit.test.ts')).toBe('text from the first reader');
	});

	test('leaves out a test file that cannot be read', async () => {
		const { cwd } = setupRepo();

		const input = await buildTestFileInput({ cwd, tests: ['src/ghost.unit.test.ts'], cache: new Map() });

		expect(input.tests).toStrictEqual(['src/ghost.unit.test.ts']);
		expect(input.contents.size).toBe(0);
	});
});
