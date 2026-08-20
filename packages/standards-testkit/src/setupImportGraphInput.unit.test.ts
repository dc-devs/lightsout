import { describe, expect, test } from '@jest/globals';
import { StandardsInputKind } from '@lightsout/standards-contracts';
import { setupImportGraphInput } from '#src/index.ts';

describe('setupImportGraphInput', () => {
	test('builds the arm an import-graph check narrows to', () => {
		expect(setupImportGraphInput().kind).toBe(StandardsInputKind.ImportGraph);
	});

	test('both ends of every edge become known files', () => {
		const input = setupImportGraphInput({ edges: [{ from: 'src/a.ts', to: 'src/b.ts' }] });

		// a test states the graph once rather than stating it and then separately
		// listing its own participants
		expect(input).toMatchObject({ files: ['src/a.ts', 'src/b.ts'], source: ['src/a.ts', 'src/b.ts'] });
	});

	test('a file at both ends of the graph is listed once', () => {
		const input = setupImportGraphInput({
			edges: [
				{ from: 'src/a.ts', to: 'src/b.ts' },
				{ from: 'src/b.ts', to: 'src/c.ts' },
			],
		});

		expect(input).toMatchObject({ files: ['src/a.ts', 'src/b.ts', 'src/c.ts'] });
	});
});
