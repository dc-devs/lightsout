import type ts from 'typescript';
import type { RawStandardsFinding, StandardsCheckModule, SyntaxTreeInput } from '@/contracts';
import { buildRawFinding } from '../../../../../common/utils/buildRawFinding.ts';

/**
 * Whether an assertion is the `as const` form. That one asserts nothing about a
 * value's type — it freezes a literal — and the named-constants document asks
 * for it by name, so it is not what this rule bans.
 */
const isAsConst = ({ node, compiler }: { node: ts.AsExpression; compiler: typeof ts }) =>
	compiler.isTypeReferenceNode(node.type) && compiler.isIdentifier(node.type.typeName) && node.type.typeName.text === 'const';

/**
 * The lines in one file carrying an `as` cast, 1-based.
 *
 * Only source files reach a check declaring this input — the engine hands over
 * parsed trees for source and keeps test files separate — so the document's
 * test-file allowance for `as unknown as T` needs nothing here to hold.
 */
const getAssertionLines = ({ sourceFile, compiler }: { sourceFile: ts.SourceFile; compiler: typeof ts }) => {
	const lines: number[] = [];

	const visit = (node: ts.Node) => {
		if (compiler.isAsExpression(node) && !isAsConst({ node, compiler })) {
			lines.push(sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1);
		}

		node.forEachChild(visit);
	};

	visit(sourceFile);

	return lines;
};

/** One finding per file: the remedy is to prove the types this file works with, which is one pass over it. */
const buildFileFindings = ({ input }: { input: SyntaxTreeInput }) => {
	const findings: RawStandardsFinding[] = [];

	for (const [path, tree] of input.trees) {
		const lines = getAssertionLines({ sourceFile: tree, compiler: input.compiler });

		if (lines.length > 0) {
			findings.push(
				buildRawFinding({
					rule: 'type-assertion',
					files: [{ path }],
					detail: `\`as\` cast at ${lines.length > 1 ? 'lines' : 'line'} ${lines.join(', ')}`,
					guidance: 'Narrow with `typeof`, `instanceof` or a discriminated union — an assertion that is genuinely unavoidable needs a comment saying why.',
				}),
			);
		}
	}

	return findings;
};

export const check: StandardsCheckModule = {
	inputKind: 'syntax-tree',
	// Scanning for the word would hit `as` in an import alias, a string and a
	// comment alike; only the tree says which occurrence is the assertion.
	run: ({ input }): RawStandardsFinding[] => (input.kind === 'syntax-tree' ? buildFileFindings({ input }) : []),
};
