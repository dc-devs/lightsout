import type { StandardsCheckModule } from '@lightsout/standards-contracts';
import type ts from 'typescript';
import { buildTreeLineCheck } from '../../../../common/checks/buildTreeLineCheck.ts';

/** Whether a declaration carries the `export` keyword. */
const isExported = ({ node, compiler }: { node: ts.Node; compiler: typeof ts }) =>
	compiler.canHaveModifiers(node) && (compiler.getModifiers(node) ?? []).some((modifier) => modifier.kind === compiler.SyntaxKind.ExportKeyword);

/**
 * Whether an alias only renames: its right-hand side is one type reference and
 * nothing else.
 *
 * Type ARGUMENTS are what separate a rename from a derivation — `z.infer<typeof
 * Schema>` and `ReturnType<typeof make>` are references too, and they compute a
 * type rather than give an existing one a second name. Only the bare form is a
 * rename.
 */
const isBareRename = ({ node, compiler }: { node: ts.TypeAliasDeclaration; compiler: typeof ts }) =>
	compiler.isTypeReferenceNode(node.type) && node.type.typeArguments === undefined && node.typeParameters === undefined;

/**
 * The line of an exported bare-rename alias, when it is the only thing the file
 * exports — 1-based, and at most one per file.
 *
 * The rule is about a FILE that exists only to rename a type, so the file's
 * other exports are what decide: an alias sitting beside the code that uses it
 * is a local convenience, while an alias alone in a file is a hop a reader has
 * to make to learn nothing.
 */
const getIndirectionLines = ({ sourceFile, compiler }: { sourceFile: ts.SourceFile; compiler: typeof ts }) => {
	const exported = sourceFile.statements.filter((statement) => isExported({ node: statement, compiler }));
	const [only] = exported;

	return exported.length === 1 && only !== undefined && compiler.isTypeAliasDeclaration(only) && isBareRename({ node: only, compiler })
		? [sourceFile.getLineAndCharacterOfPosition(only.getStart()).line + 1]
		: [];
};

// The tree, not the text: `export type A = B` and `export type A = B<C>` differ
// by two characters and only one of them is a rename.
export const check: StandardsCheckModule = buildTreeLineCheck({
	rule: 'type-alias-indirection',
	findLines: getIndirectionLines,
	detail: ({ lines }) => `the file's only export is a type alias renaming another type, at line ${lines.join(', ')}`,
	guidance:
		'Use the original type directly and delete the file — where the semantic distinction matters, a comment at the usage site says it more cheaply than a hop.',
});
