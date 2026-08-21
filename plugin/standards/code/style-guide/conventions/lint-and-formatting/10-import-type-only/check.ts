import type { RawStandardsFinding, StandardsCheckModule, SyntaxTreeInput } from '@lightsout/standards-contracts';
import type ts from 'typescript';
import { buildRawFinding } from '../../../../../common/findings/buildRawFinding.ts';

/**
 * Every name the file mentions, split by whether the mention sits inside a type
 * node. The import clause itself is skipped — it binds the names, it does not
 * use them — and `typeof X` counts as a type position, since that is exactly
 * the form `import type` still permits.
 */
const collectNameUses = ({ sourceFile, compiler }: { sourceFile: ts.SourceFile; compiler: typeof ts }) => {
	const inTypes = new Set<string>();
	const inValues = new Set<string>();

	const visit = ({ node, isType }: { node: ts.Node; isType: boolean }) => {
		if (!compiler.isImportDeclaration(node)) {
			const nested = isType || compiler.isTypeNode(node);

			if (compiler.isIdentifier(node)) {
				(nested ? inTypes : inValues).add(node.text);
			}

			node.forEachChild((child) => visit({ node: child, isType: nested }));
		}
	};

	visit({ node: sourceFile, isType: false });

	return { inTypes, inValues };
};

/**
 * The local names one import clause binds as values. A clause already written
 * `import type`, and a specifier already written `type X`, bind nothing here —
 * they erase already, which is the whole point of the rule.
 */
const getValueBindings = ({ declaration, compiler }: { declaration: ts.ImportDeclaration; compiler: typeof ts }) => {
	const clause = declaration.importClause;
	const names: string[] = [];

	if (clause !== undefined && !clause.isTypeOnly) {
		if (clause.name !== undefined) {
			names.push(clause.name.text);
		}

		const bindings = clause.namedBindings;

		if (bindings !== undefined && compiler.isNamespaceImport(bindings)) {
			names.push(bindings.name.text);
		}

		if (bindings !== undefined && compiler.isNamedImports(bindings)) {
			names.push(...bindings.elements.filter((element) => !element.isTypeOnly).map((element) => element.name.text));
		}
	}

	return names;
};

/** The module specifiers of one file's imports that every reference proves type-only. */
const getTypeOnlySpecifiers = ({ sourceFile, compiler }: { sourceFile: ts.SourceFile; compiler: typeof ts }) => {
	const { inTypes, inValues } = collectNameUses({ sourceFile, compiler });
	const specifiers: string[] = [];

	for (const statement of sourceFile.statements) {
		if (compiler.isImportDeclaration(statement) && compiler.isStringLiteral(statement.moduleSpecifier)) {
			const names = getValueBindings({ declaration: statement, compiler });

			// An import nothing references at all is an unused import, a different
			// fault with a different fix — so at least one type reference is required.
			if (names.length > 0 && names.every((name) => inTypes.has(name) && !inValues.has(name))) {
				specifiers.push(statement.moduleSpecifier.text);
			}
		}
	}

	return specifiers;
};

/** One finding per file, since the fix is one pass over that file's import block rather than a job per line. */
const buildFileFindings = ({ input }: { input: SyntaxTreeInput }) => {
	const findings: RawStandardsFinding[] = [];

	for (const [path, tree] of input.trees) {
		const specifiers = getTypeOnlySpecifiers({ sourceFile: tree, compiler: input.compiler });

		if (specifiers.length > 0) {
			findings.push(
				buildRawFinding({
					rule: 'import-type-only',
					files: [{ path }],
					detail: `${specifiers.map((specifier) => `'${specifier}'`).join(', ')} ${specifiers.length > 1 ? 'are' : 'is'} used only in type positions`,
					guidance: 'Write it as `import type` so it erases at compile time.',
				}),
			);
		}
	}

	return findings;
};

export const check: StandardsCheckModule = {
	inputKind: 'syntax-tree',
	// Whether a name is used only in type positions is a question about where its
	// references sit in the tree, which no line-level scan can answer: the same
	// identifier reads identically in an annotation and in a call.
	run: ({ input }): RawStandardsFinding[] => (input.kind === 'syntax-tree' ? buildFileFindings({ input }) : []),
};
