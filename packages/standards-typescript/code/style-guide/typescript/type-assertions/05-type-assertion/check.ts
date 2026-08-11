import type { StandardsCheckModule } from '@lightsout/standards-contracts';
import type ts from 'typescript';
import { buildTreeLineCheck } from '../../../../../common/utils/buildTreeLineCheck.ts';

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

// Scanning for the word would hit `as` in an import alias, a string and a
// comment alike; only the tree says which occurrence is the assertion.
export const check: StandardsCheckModule = buildTreeLineCheck({
	rule: 'type-assertion',
	findLines: getAssertionLines,
	detail: ({ lines }) => `\`as\` cast at ${lines.length > 1 ? 'lines' : 'line'} ${lines.join(', ')}`,
	guidance: 'Narrow with `typeof`, `instanceof` or a discriminated union — an assertion that is genuinely unavoidable needs a comment saying why.',
});
