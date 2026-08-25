import type { ImportGraphInput, StandardsCheckInput } from '@lightsout/standards-contracts';
import { StandardsInputKind } from '@lightsout/standards-contracts';

interface Params extends Partial<Omit<ImportGraphInput, 'kind' | 'dependencies'>> {
	edges?: Array<{ from: string; to: string }>;
	dependencies?: Array<[string, string[]]>;
}

/**
 * The input an `import-graph` check receives, built in memory.
 *
 * Both ends of every edge become known files, so a test states the graph once
 * rather than stating it and then separately listing its own participants.
 *
 * @param edges - which file imports which
 * @param dependencies - declared dependency names per package directory, as pairs — the same shape the file-list and syntax-tree factories take, so a rule needing a framework carve-out is arranged the same way whichever input it reads
 */
export const setupImportGraphInput = ({ edges = [], dependencies = [], ...overrides }: Params = {}): StandardsCheckInput => {
	const paths = [...new Set(edges.flatMap(({ from, to }) => [from, to]))];

	return {
		kind: StandardsInputKind.ImportGraph,
		cwd: '/repo',
		source: paths,
		tests: [],
		files: paths,
		referenceFiles: [],
		standardsPacks: [],
		edges,
		dependencies: new Map(dependencies),
		...overrides,
	};
};
