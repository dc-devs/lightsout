import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { expectDefined } from '@tests/helpers/expectDefined';
import { resolveConsumerTypescript } from '@/common/utils/resolveConsumerTypescript';
import { buildImportGraphInput } from '@/standardsCheck/common/checkInputs/buildImportGraphInput';

const setupRepo = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-import-graph-'));

	mkdirSync(join(cwd, 'src/feature'), { recursive: true });
	writeFileSync(join(cwd, 'src/feature/internal.ts'), 'export const internal = 1;\n');
	writeFileSync(join(cwd, 'src/consumer.ts'), "import { internal } from './feature/internal';\n\nexport const consumer = () => internal;\n");

	return { cwd };
};

const compiler = resolveConsumerTypescript({ cwd: process.cwd() });

describe('buildImportGraphInput', () => {
	test('resolves the edges among the repo files and reports them repo-relative', async () => {
		const { cwd } = setupRepo();
		const files = ['src/consumer.ts', 'src/feature/internal.ts'];

		expectDefined(compiler);

		const input = await buildImportGraphInput({ cwd, source: files, tests: [], files, referenceFiles: files, standardsPackages: [], compiler });

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
			standardsPackages: [],
			compiler,
		});

		// the importer sits outside the scope; a boundary rule still has to see it
		expect(input.edges).toStrictEqual([{ from: 'src/consumer.ts', to: 'src/feature/internal.ts' }]);
	});
});
