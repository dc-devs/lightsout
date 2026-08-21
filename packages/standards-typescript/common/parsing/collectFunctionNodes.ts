import type ts from 'typescript';
import type { FunctionNode } from '../types/FunctionNode.ts';
import { getFunctionName } from './getFunctionName.ts';

interface Params {
	/** One parsed file, as the syntax-tree input holds it. */
	sourceFile: ts.SourceFile;
	compiler: typeof ts;
}

/** The node's body when it is function-like, else undefined. The four guards narrow it, so nothing is asserted. */
const getBody = ({ node, compiler }: { node: ts.Node; compiler: typeof ts }) =>
	compiler.isFunctionDeclaration(node) || compiler.isMethodDeclaration(node) || compiler.isArrowFunction(node) || compiler.isFunctionExpression(node)
		? node.body
		: undefined;

/**
 * Every function-like node in one parsed file, with the name it reports under
 * and the lines it spans.
 *
 * Parsing is the expensive half of an AST rule and this walk is most of the
 * rest, so the rules that ask "which functions are in this file?" — duplicated
 * bodies, function size — share one answer instead of each writing the same
 * traversal with a different bug in it.
 *
 * Nested functions are included: a callback's body is a duplicate candidate
 * like any other, and a rule that must spare callbacks says so itself by the
 * name they report under.
 */
export const collectFunctionNodes = ({ sourceFile, compiler }: Params): FunctionNode[] => {
	const found: FunctionNode[] = [];

	const visit = (node: ts.Node) => {
		const body = getBody({ node, compiler });

		// An overload signature is function-like with no body — there is nothing
		// in it to measure or compare.
		if (body !== undefined) {
			found.push({
				name: getFunctionName({ node, compiler }),
				startLine: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
				endLine: sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
				body,
			});
		}

		node.forEachChild(visit);
	};

	visit(sourceFile);

	return found;
};
