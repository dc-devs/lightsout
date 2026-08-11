import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { expectDefined } from '@tests/helpers/expectDefined';
import { resolveConsumerTypescript } from '@/common/utils/resolveConsumerTypescript';
import { buildSyntaxTreeInput } from '@/standardsCheck/common/checkInputs/buildSyntaxTreeInput';

const setupRepo = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-syntax-tree-'));

	mkdirSync(join(cwd, 'src'), { recursive: true });
	writeFileSync(join(cwd, 'src/alpha.ts'), 'export const alpha = () => 1;\n');

	return { cwd };
};

// The engine never bundles a compiler; this suite borrows the one the repo it
// runs in already has, exactly as a run borrows the consumer's.
const compiler = resolveConsumerTypescript({ cwd: process.cwd() });

const buildInput = ({ cwd, source, cache }: { cwd: string; source: string[]; cache: Map<string, string> }) => {
	expectDefined(compiler);

	return buildSyntaxTreeInput({ cwd, source, tests: [], files: source, referenceFiles: source, standardsPackages: [], compiler, cache });
};

describe('buildSyntaxTreeInput', () => {
	test('parses one tree per source file, with parents set so a rule can walk back up', async () => {
		const { cwd } = setupRepo();

		const input = await buildInput({ cwd, source: ['src/alpha.ts'], cache: new Map() });
		const tree = input.trees.get('src/alpha.ts');

		expect(input.kind).toBe('syntax-tree');
		expectDefined(tree);
		expect(tree.statements).toHaveLength(1);
		expect(tree.statements[0]?.parent).toBe(tree);
	});

	test('parses the text the run already cached rather than reading the file again', async () => {
		const { cwd } = setupRepo();
		const cache = new Map<string, string>([['src/alpha.ts', 'export const alpha = 1;\nexport const beta = 2;\n']]);

		const input = await buildInput({ cwd, source: ['src/alpha.ts'], cache });

		expect(input.trees.get('src/alpha.ts')?.statements).toHaveLength(2);
	});

	test('skips a source file that cannot be read instead of parsing nothing into a tree', async () => {
		const { cwd } = setupRepo();

		const input = await buildInput({ cwd, source: ['src/ghost.ts'], cache: new Map() });

		expect(input.trees.size).toBe(0);
	});
});
