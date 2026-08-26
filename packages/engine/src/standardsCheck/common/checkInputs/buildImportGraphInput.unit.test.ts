import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resolveConsumerTypescript } from '#src/common/workspace/resolveConsumerTypescript.ts';
import { buildImportGraphInput } from '#src/standardsCheck/common/checkInputs/buildImportGraphInput.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';

const setupRepo = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-import-graph-'));

	mkdirSync(join(cwd, 'src/feature'), { recursive: true });
	writeFileSync(join(cwd, 'src/feature/internal.ts'), 'export const internal = 1;\n');
	writeFileSync(join(cwd, 'src/consumer.ts'), "import { internal } from './feature/internal';\n\nexport const consumer = () => internal;\n");

	mkdirSync(join(cwd, 'packages/web'), { recursive: true });
	writeFileSync(join(cwd, 'package.json'), '{ "name": "root" }\n');
	writeFileSync(join(cwd, 'packages/web/package.json'), '{ "name": "web", "dependencies": { "@tanstack/react-router": "^1" } }\n');

	return { cwd };
};

const compiler = resolveConsumerTypescript({ cwd: process.cwd() });

describe('buildImportGraphInput', () => {
	test('resolves the edges among the repo files and reports them repo-relative', async () => {
		const { cwd } = setupRepo();
		const files = ['src/consumer.ts', 'src/feature/internal.ts'];

		expectDefined(compiler);

		const input = await buildImportGraphInput({
			cwd,
			source: files,
			tests: [],
			files,
			referenceFiles: files,
			standardsPacks: [],
			compiler,
			packagesDir: 'packages',
		});

		expect(input.kind).toBe('import-graph');
		expect(input.edges).toStrictEqual([{ from: 'src/consumer.ts', to: 'src/feature/internal.ts' }]);
	});

	test('builds the graph from the whole repo, not the narrowed scope a run was asked for', async () => {
		const { cwd } = setupRepo();

		expectDefined(compiler);

		const input = await buildImportGraphInput({
			cwd,
			source: ['src/feature/internal.ts'],
			tests: [],
			files: ['src/feature/internal.ts'],
			referenceFiles: ['src/consumer.ts', 'src/feature/internal.ts'],
			standardsPacks: [],
			compiler,
			packagesDir: 'packages',
		});

		// the importer sits outside the scope; a boundary rule still has to see it
		expect(input.edges).toStrictEqual([{ from: 'src/consumer.ts', to: 'src/feature/internal.ts' }]);
	});

	test('carries what each package declares, so a boundary rule can tell a framework-mandated folder from one the repo chose', async () => {
		const { cwd } = setupRepo();
		const files = ['src/consumer.ts', 'src/feature/internal.ts'];

		expectDefined(compiler);

		const input = await buildImportGraphInput({
			cwd,
			source: files,
			tests: [],
			files,
			referenceFiles: files,
			standardsPacks: [],
			compiler,
			packagesDir: 'packages',
		});

		expect(input.dependencies).toStrictEqual(
			new Map([
				['.', []],
				['packages/web', ['@tanstack/react-router']],
			]),
		);
	});
});
