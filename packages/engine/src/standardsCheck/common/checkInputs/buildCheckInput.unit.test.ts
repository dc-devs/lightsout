import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resolveConsumerTypescript } from '#src/common/workspace/resolveConsumerTypescript.ts';
import { StandardsInputKind } from '#src/contracts/index.ts';
import { buildCheckInput } from '#src/standardsCheck/common/checkInputs/buildCheckInput.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';

const setupRepo = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-check-input-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/alpha.ts'), 'export const alpha = 1;\n');
	writeFileSync(join(cwd, 'src/alpha.unit.test.ts'), "test('alpha', () => {});\n");

	return { cwd };
};

const compiler = resolveConsumerTypescript({ cwd: process.cwd() });

const buildInput = ({ kind, cwd, withCompiler = true }: { kind: StandardsInputKind; cwd: string; withCompiler?: boolean }) =>
	buildCheckInput({
		kind,
		cwd,
		source: ['src/alpha.ts'],
		tests: ['src/alpha.unit.test.ts'],
		files: ['src/alpha.ts', 'src/alpha.unit.test.ts'],
		referenceFiles: ['src/alpha.ts', 'src/alpha.unit.test.ts'],
		standardsPackages: [],
		packagesDir: 'packages',
		settings: { minTokens: 50 },
		cache: new Map<string, string>(),
		compiler: withCompiler ? compiler : undefined,
	});

describe('buildCheckInput', () => {
	test('builds the shape the declared kind names, for every kind in the closed set', async () => {
		const { cwd } = setupRepo();

		for (const kind of Object.values(StandardsInputKind)) {
			expect((await buildInput({ kind, cwd })).kind).toBe(kind);
		}
	});

	test('refuses a syntax-tree input when no typescript resolved, naming the kind', async () => {
		const { cwd } = setupRepo();

		const error = await getRejectionError({ promise: buildInput({ kind: StandardsInputKind.SyntaxTree, cwd, withCompiler: false }) });

		expect(error.message).toContain('syntax-tree');
		expect(error.message).toContain('typescript');
	});

	test('refuses an import-graph input when no typescript resolved', async () => {
		const { cwd } = setupRepo();

		const error = await getRejectionError({ promise: buildInput({ kind: StandardsInputKind.ImportGraph, cwd, withCompiler: false }) });

		expect(error.message).toContain('import-graph');
	});
});
