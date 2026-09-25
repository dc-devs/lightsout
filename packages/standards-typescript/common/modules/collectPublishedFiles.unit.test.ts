import { describe, expect, test } from '@jest/globals';
import { collectPublishedFiles } from './collectPublishedFiles.ts';

const setupGraph = ({ edges }: { edges: Array<[string, string]> }) => {
	const targetsByFile = new Map<string, Set<string>>();

	for (const [from, to] of edges) {
		targetsByFile.set(from, (targetsByFile.get(from) ?? new Set<string>()).add(to));
	}

	return targetsByFile;
};

describe('collectPublishedFiles', () => {
	test('publishes every file the barrel re-exports from, and every file a lower barrel it re-exports from publishes', () => {
		const targetsByFile = setupGraph({
			edges: [
				['src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts'],
				['src/ingestion/index.ts', 'src/ingestion/parser/index.ts'],
				['src/ingestion/parser/index.ts', 'src/ingestion/parser/parseRow.ts'],
				['src/ingestion/parser/parseRow.ts', 'src/ingestion/parser/tokenize.ts'],
			],
		});

		const published = collectPublishedFiles({ barrelPath: 'src/ingestion/index.ts', targetsByFile });

		// tokenize.ts is only imported by a published file, which publishes nothing
		expect([...published].sort()).toStrictEqual(['src/ingestion/ingestRecords.ts', 'src/ingestion/parser/index.ts', 'src/ingestion/parser/parseRow.ts']);
	});

	test('follows a chain that loops back on itself once', () => {
		const targetsByFile = setupGraph({
			edges: [
				['src/a/index.ts', 'src/a/b/index.ts'],
				['src/a/b/index.ts', 'src/a/index.ts'],
				['src/a/b/index.ts', 'src/a/b/leaf.ts'],
			],
		});

		const published = collectPublishedFiles({ barrelPath: 'src/a/index.ts', targetsByFile });

		expect([...published].sort()).toStrictEqual(['src/a/b/index.ts', 'src/a/b/leaf.ts', 'src/a/index.ts']);
	});

	test('a barrel with no edge leaving it publishes nothing', () => {
		const published = collectPublishedFiles({ barrelPath: 'src/empty/index.ts', targetsByFile: new Map() });

		expect(published).toStrictEqual(new Set());
	});
});
