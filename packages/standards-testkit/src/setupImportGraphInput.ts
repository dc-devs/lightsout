import type { ImportGraphInput, StandardsCheckInput } from '@lightsout/standards-contracts';
import { StandardsInputKind } from '@lightsout/standards-contracts';

interface Params extends Partial<Omit<ImportGraphInput, 'kind'>> {
	/** Which file imports which. */
	edges?: Array<{ from: string; to: string }>;
}

/**
 * The input an `import-graph` check receives, built in memory.
 *
 * Both ends of every edge become known files, so a test states the graph once
 * rather than stating it and then separately listing its own participants.
 *
 * @param edges - the import relationships
 */
export const setupImportGraphInput = ({ edges = [], ...overrides }: Params = {}): StandardsCheckInput => {
	const paths = [...new Set(edges.flatMap(({ from, to }) => [from, to]))];

	return {
		kind: StandardsInputKind.ImportGraph,
		cwd: '/repo',
		source: paths,
		tests: [],
		files: paths,
		referenceFiles: [],
		standardsPackages: [],
		edges,
		...overrides,
	};
};
