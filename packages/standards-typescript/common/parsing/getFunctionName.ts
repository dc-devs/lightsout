import type ts from 'typescript';

interface Params {
	node: ts.Node;
	/** The consumer's TypeScript, exactly as the syntax-tree input hands it over. */
	compiler: typeof ts;
}

/**
 * The name a function-like node reports under: its own name, else the variable
 * it is assigned to, else `(anonymous)`.
 *
 * Arrow functions carry no name of their own, so the variable declaration is
 * where the useful label lives — and `(anonymous)` is the honest answer for a
 * callback nobody named, which is also how the rules that must skip callbacks
 * recognise them.
 */
export const getFunctionName = ({ node, compiler }: Params): string => {
	let name = '(anonymous)';

	if ((compiler.isFunctionDeclaration(node) || compiler.isMethodDeclaration(node)) && node.name) {
		name = node.name.getText();
	} else if (node.parent && compiler.isVariableDeclaration(node.parent) && compiler.isIdentifier(node.parent.name)) {
		name = node.parent.name.getText();
	}

	return name;
};
