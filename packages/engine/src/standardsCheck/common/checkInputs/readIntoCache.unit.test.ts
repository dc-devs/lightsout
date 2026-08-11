import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readIntoCache } from '@/standardsCheck/common/checkInputs/readIntoCache';

const setupRepo = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-cache-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/alpha.ts'), 'export const alpha = 1;\n');
	writeFileSync(join(cwd, 'src/beta.ts'), 'export const beta = 2;\n');

	return { cwd };
};

describe('readIntoCache', () => {
	test('fills the cache with the text of every readable path', async () => {
		const { cwd } = setupRepo();
		const cache = new Map<string, string>();

		await readIntoCache({ cwd, paths: ['src/alpha.ts', 'src/beta.ts'], cache });

		expect(cache.get('src/alpha.ts')).toBe('export const alpha = 1;\n');
		expect(cache.get('src/beta.ts')).toBe('export const beta = 2;\n');
	});

	test('leaves an unreadable path out of the cache instead of storing an empty string', async () => {
		const { cwd } = setupRepo();
		const cache = new Map<string, string>();

		await readIntoCache({ cwd, paths: ['src/alpha.ts', 'src/ghost.ts'], cache });

		// absent, not '' — a check must be able to tell "no text" from "empty file"
		expect(cache.has('src/ghost.ts')).toBe(false);
		expect(cache.size).toBe(1);
	});

	test('never reads a path the cache already holds', async () => {
		const { cwd } = setupRepo();
		const cache = new Map<string, string>([['src/alpha.ts', 'text from the first reader']]);

		await readIntoCache({ cwd, paths: ['src/alpha.ts'], cache });

		// the cached text survives, which is what "read once per run" means
		expect(cache.get('src/alpha.ts')).toBe('text from the first reader');
	});
});
