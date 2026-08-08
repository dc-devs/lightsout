import type ts from 'typescript';

interface Params {
	node: ts.Node;
	/** The consumer's TypeScript, borrowed exactly as the AST tier borrows it. */
	compiler: typeof ts;
}

/**
 * Flatten a function body to a token stream with identifiers and literals
 * blurred, so two functions that differ only in naming hash identically. The
 * basis of the duplicate-function check.
 *
 * Split out of `checkAstFindings` to leave that function sequencing its passes.
 * A module internal — its behaviour is pinned through the AST tier's own tests.
 */
export const normalizeFunctionTokens = ({ node, compiler }: Params): string[] => {
	if (compiler.isIdentifier(node) || compiler.isPrivateIdentifier(node)) {
		// Hook names stay significant: in React, "calls a different hook" is
		// exactly what makes two otherwise-identical functions legitimately
		// un-mergeable (the Rules of Hooks forbid parameterizing or
		// conditionally calling them), so blurring use* identifiers
		// manufactured duplicates out of thin wrappers that each bind a
		// different hook — an irreducible, idiomatic pattern.
		return /^use[A-Z]/.test(node.text) ? [node.text] : ['ID'];
	}

	if (
		compiler.isStringLiteralLike(node) ||
		compiler.isNumericLiteral(node) ||
		node.kind === compiler.SyntaxKind.TrueKeyword ||
		node.kind === compiler.SyntaxKind.FalseKeyword
	) {
		return ['LIT'];
	}

	const children = node.getChildren();

	if (children.length === 0) {
		return [String(node.kind)];
	}

	return children.flatMap((child) => normalizeFunctionTokens({ node: child, compiler }));
};
