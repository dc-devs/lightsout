import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { buildFileTextInput } from '@/standardsCheck/common/checkInputs/buildFileTextInput';

const setupRepo = ({ tsconfig = true, packageTsconfig = false }: { tsconfig?: boolean; packageTsconfig?: boolean } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-file-text-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/alpha.ts'), 'export const alpha = 1;\n');
	writeFileSync(join(cwd, 'src/outside.ts'), 'export const outside = 2;\n');

	if (tsconfig) {
		writeFileSync(join(cwd, 'tsconfig.json'), '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }\n');
	}

	if (packageTsconfig) {
		mkdirSync(join(cwd, 'packages/engine/src'), { recursive: true });
		writeFileSync(join(cwd, 'packages/engine/src/beta.ts'), 'export const beta = 3;\n');
		writeFileSync(join(cwd, 'packages/engine/tsconfig.json'), '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }\n');
	}

	return { cwd };
};

const buildInput = ({ cwd, cache, files = ['src/alpha.ts'] }: { cwd: string; cache: Map<string, string>; files?: string[] }) =>
	buildFileTextInput({
		cwd,
		source: files,
		tests: [],
		files,
		referenceFiles: [...files, 'src/outside.ts'],
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

	test("adds a package's own tsconfig, which in a workspace is the only place its aliases are declared", async () => {
		const { cwd } = setupRepo({ packageTsconfig: true });

		const input = await buildInput({ cwd, cache: new Map(), files: ['packages/engine/src/beta.ts'] });

		// reading only the root config found no aliases anywhere in a monorepo,
		// which made every aliased barrel in it look like it exported nothing
		expect(input.contents.get('packages/engine/tsconfig.json')).toContain('"@/*"');
	});

	test('probes every folder above a file, so a config at any depth is found', async () => {
		const { cwd } = setupRepo({ tsconfig: false, packageTsconfig: true });

		const input = await buildInput({ cwd, cache: new Map(), files: ['packages/engine/src/beta.ts'] });

		expect([...input.contents.keys()]).toContain('packages/engine/tsconfig.json');
	});

	test('a folder holding no tsconfig contributes nothing rather than an empty entry', async () => {
		const { cwd } = setupRepo({ packageTsconfig: true });

		const input = await buildInput({ cwd, cache: new Map(), files: ['packages/engine/src/beta.ts'] });

		expect(input.contents.has('packages/engine/src/tsconfig.json')).toBe(false);
		expect(input.contents.has('packages/tsconfig.json')).toBe(false);
	});

	test('hands back the run cache itself, so a second kind reuses what it read', async () => {
		const { cwd } = setupRepo();
		const cache = new Map<string, string>();

		const input = await buildInput({ cwd, cache });

		expect(input.contents).toBe(cache);
	});
});
