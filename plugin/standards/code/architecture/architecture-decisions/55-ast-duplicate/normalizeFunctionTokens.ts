import type ts from 'typescript';

interface Params {
	node: ts.Node;
	/** The consumer's TypeScript, exactly as the syntax-tree input hands it over. */
	compiler: typeof ts;
}

/** The literal kinds whose value is blurred away — two functions differing only in the numbers they use are still the same function. */
const isBlurredLiteral = ({ node, compiler }: { node: ts.Node; compiler: typeof ts }) =>
	compiler.isStringLiteralLike(node) ||
	compiler.isNumericLiteral(node) ||
	node.kind === compiler.SyntaxKind.TrueKeyword ||
	node.kind === compiler.SyntaxKind.FalseKeyword;

/**
 * A function body flattened to a token stream with identifiers and literals
 * blurred, so two functions differing only in naming produce the same stream.
 *
 * Hook names stay significant: in React, "calls a different hook" is exactly
 * what makes two otherwise-identical functions legitimately un-mergeable — the
 * Rules of Hooks forbid parameterizing or conditionally calling them — so
 * blurring `use*` identifiers manufactured duplicates out of thin wrappers that
 * each bind a different hook, an irreducible and idiomatic pattern.
 *
 * Private to this rule: no other rule compares bodies, and a shared normalizer
 * would be a contract two rules could pull in opposite directions.
 */
export const normalizeFunctionTokens = ({ node, compiler }: Params): string[] => {
	let tokens: string[];

	if (compiler.isIdentifier(node) || compiler.isPrivateIdentifier(node)) {
		tokens = /^use[A-Z]/.test(node.text) ? [node.text] : ['ID'];
	} else if (isBlurredLiteral({ node, compiler })) {
		tokens = ['LIT'];
	} else {
		const children = node.getChildren();

		tokens = children.length === 0 ? [String(node.kind)] : children.flatMap((child) => normalizeFunctionTokens({ node: child, compiler }));
	}

	return tokens;
};
