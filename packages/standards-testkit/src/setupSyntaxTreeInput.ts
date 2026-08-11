import type { StandardsCheckInput, SyntaxTreeInput } from '@lightsout/standards-contracts';
import { StandardsInputKind } from '@lightsout/standards-contracts';
import ts from 'typescript';

interface Params extends Partial<Omit<SyntaxTreeInput, 'kind' | 'trees' | 'compiler'>> {
	/** Each file and its text; the tree is parsed for you. */
	sources?: Array<[string, string]>;
}

/**
 * The input a `syntax-tree` check receives, with every source parsed.
 *
 * The compiler is this package's own, imported directly. The hand-rolled copies
 * of this factory each borrowed the engine's `resolveConsumerTypescript`, which
 * answers a different question — it finds the compiler belonging to whatever
 * repo is being CHECKED, and returns nothing when that repo has none. A rule's
 * unit test is not checking a repo; it wants any compiler that can parse a
 * string, and the one beside it always can.
 *
 * Parsed with parent pointers set, because checks walk upward from a node far
 * more often than they walk down, and a tree without them fails in ways that
 * look like the rule is wrong rather than the fixture.
 *
 * @param sources - each file and its text
 */
export const setupSyntaxTreeInput = ({ sources = [], ...overrides }: Params = {}): StandardsCheckInput => {
	const paths = sources.map(([path]) => path);
	const trees = new Map(sources.map(([path, text]) => [path, ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)]));

	return {
		kind: StandardsInputKind.SyntaxTree,
		cwd: '/repo',
		source: paths,
		tests: [],
		files: paths,
		referenceFiles: [],
		standardsPackages: [],
		compiler: ts,
		trees,
		...overrides,
	};
};
