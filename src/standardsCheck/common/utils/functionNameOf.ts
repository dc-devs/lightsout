import type ts from 'typescript';

interface Params {
	node: ts.Node;
	/** The consumer's TypeScript, borrowed exactly as the AST tier borrows it. */
	compiler: typeof ts;
}

/**
 * The reportable name of a function-like node: its own name, else the variable
 * it is assigned to, else `(anonymous)`. Arrow functions carry no name of their
 * own, so the variable declaration is where the useful label lives.
 *
 * Split out of `checkAstFindings` to leave that function sequencing its passes.
 * A module internal — its behaviour is pinned through the AST tier's own tests.
 */
export const functionNameOf = ({ node, compiler }: Params): string => {
	if ((compiler.isFunctionDeclaration(node) || compiler.isMethodDeclaration(node)) && node.name) {
		return node.name.getText();
	}

	const parent = node.parent;

	if (parent && compiler.isVariableDeclaration(parent) && compiler.isIdentifier(parent.name)) {
		return parent.name.getText();
	}

	return '(anonymous)';
};
