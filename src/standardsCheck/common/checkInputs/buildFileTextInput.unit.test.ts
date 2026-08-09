import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { buildFileTextInput } from '@/standardsCheck/common/checkInputs/buildFileTextInput';

const setupRepo = ({ tsconfig = true }: { tsconfig?: boolean } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-file-text-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/alpha.ts'), 'export const alpha = 1;\n');
	writeFileSync(join(cwd, 'src/outside.ts'), 'export const outside = 2;\n');

	if (tsconfig) {
		writeFileSync(join(cwd, 'tsconfig.json'), '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }\n');
	}

	return { cwd };
};

const buildInput = ({ cwd, cache }: { cwd: string; cache: Map<string, string> }) =>
	buildFileTextInput({
		cwd,
		source: ['src/alpha.ts'],
		tests: [],
		files: ['src/alpha.ts'],
		referenceFiles: ['src/alpha.ts', 'src/outside.ts'],
		standardsPackages: [],
		cache,
	});

describe('buildFileTextInput', () => {
	test('holds the text of every scoped file and every reference file', async () => {
		const { cwd } = setupRepo();

		const input = await buildInput({ cwd, cache: new Map() });

		expect(input.kind).toBe('file-text');
		expect(input.contents.get('src/alpha.ts')).toBe('export const alpha = 1;\n');
		// reference files are read too — a rule counting consumers needs them
		expect(input.contents.get('src/outside.ts')).toBe('export const outside = 2;\n');
	});

	test('adds the repo tsconfig, the one file no rule may open for itself', async () => {
		const { cwd } = setupRepo();

		const input = await buildInput({ cwd, cache: new Map() });

		expect(input.contents.get('tsconfig.json')).toContain('"@/*"');
	});

	test('leaves the tsconfig out when the repo has none', async () => {
		const { cwd } = setupRepo({ tsconfig: false });

		const input = await buildInput({ cwd, cache: new Map() });

		expect(input.contents.has('tsconfig.json')).toBe(false);
	});

	test('hands back the run cache itself, so a second kind reuses what it read', async () => {
		const { cwd } = setupRepo();
		const cache = new Map<string, string>();

		const input = await buildInput({ cwd, cache });

		expect(input.contents).toBe(cache);
	});
});
