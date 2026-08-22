import { describe, expect, test } from '@jest/globals';
import type { SyntaxTreeInput } from '@lightsout/standards-contracts';
import { StandardsInputKind } from '@lightsout/standards-contracts';
import { setupSyntaxTreeInput } from '#src/index.ts';

/** The arm under test, narrowed — every case here builds a syntax-tree input. */
const setupTrees = ({ sources }: { sources: Array<[string, string]> }) => setupSyntaxTreeInput({ sources }) as SyntaxTreeInput;

describe('setupSyntaxTreeInput', () => {
	test('builds the arm a syntax-tree check narrows to', () => {
		expect(setupSyntaxTreeInput().kind).toBe(StandardsInputKind.SyntaxTree);
	});

	test('parses each source into a tree the check can walk', () => {
		const input = setupTrees({ sources: [['src/app.ts', 'export const total = 1 + 2;\n']] });

		expect(input.trees.get('src/app.ts')?.statements).toHaveLength(1);
	});

	test('sets parent pointers, which checks walk upward through', () => {
		const input = setupTrees({ sources: [['src/app.ts', 'export const total = 1;\n']] });
		const [statement] = input.trees.get('src/app.ts')?.statements ?? [];

		// without these a check that climbs from a node to its declaration fails in
		// a way that reads as the rule being wrong rather than the fixture
		expect(statement?.parent).toBeDefined();
	});

	test('carries a real compiler, so a check can call the same API the engine hands it', () => {
		const input = setupTrees({ sources: [] });

		expect(typeof input.compiler.createSourceFile).toBe('function');
	});

	test('the paths given become both the source and the file list', () => {
		const input = setupTrees({
			sources: [
				['src/a.ts', ''],
				['src/b.ts', ''],
			],
		});

		expect(input).toMatchObject({ source: ['src/a.ts', 'src/b.ts'], files: ['src/a.ts', 'src/b.ts'] });
	});

	test('names no standards pack roots unless the test asks for one', () => {
		const input = setupTrees({ sources: [['src/app.ts', '']] });

		// the field the contract names on every arm: a rule reading it out of the
		// box sees an empty list, not undefined
		expect(input).toMatchObject({ standardsPacks: [], referenceFiles: [], tests: [], cwd: '/repo' });
	});

	test('any field can be overridden outright, standards pack roots included', () => {
		const input = setupSyntaxTreeInput({ cwd: '/elsewhere', standardsPacks: ['vendor/acme'] });

		expect(input).toMatchObject({ cwd: '/elsewhere', standardsPacks: ['vendor/acme'] });
	});

	test('dependency pairs become the map the contract declares', () => {
		const input = setupSyntaxTreeInput({ dependencies: [['.', ['zod']]] }) as SyntaxTreeInput;

		expect(input.dependencies).toEqual(new Map([['.', ['zod']]]));
	});
});
