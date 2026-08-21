import type { RawStandardsFinding, StandardsCheckModule, SyntaxTreeInput } from '@lightsout/standards-contracts';
import type ts from 'typescript';
import { buildRawFinding } from '../../../../../common/findings/buildRawFinding.ts';

/** Whether a type alias is written as a union of two or more bare string literals — the shape the document's ❌ example has. */
const isStringLiteralUnion = ({ node, compiler }: { node: ts.TypeAliasDeclaration; compiler: typeof ts }) =>
	compiler.isUnionTypeNode(node.type) &&
	node.type.types.length > 1 &&
	node.type.types.every((member) => compiler.isLiteralTypeNode(member) && compiler.isStringLiteral(member.literal));

/** The names a file declares as `const` — the backing objects a derived union would be built from. */
const getConstNames = ({ sourceFile, compiler }: { sourceFile: ts.SourceFile; compiler: typeof ts }) => {
	const names = new Set<string>();

	for (const statement of sourceFile.statements) {
		const isConstStatement = compiler.isVariableStatement(statement) && (statement.declarationList.flags & compiler.NodeFlags.Const) !== 0;

		if (isConstStatement) {
			for (const declaration of statement.declarationList.declarations) {
				if (compiler.isIdentifier(declaration.name)) {
					names.add(declaration.name.text);
				}
			}
		}
	}

	return names;
};

/**
 * The exported string unions in one file with no `const` object of the same
 * name beside them.
 *
 * The pairing is what makes the union a source of truth: with the object
 * present, the union is derived from it and consumers dot into the object. With
 * only the type, every call site retypes the literal, which is the failure the
 * document describes.
 */
const getBareUnions = ({ sourceFile, compiler }: { sourceFile: ts.SourceFile; compiler: typeof ts }) => {
	const constNames = getConstNames({ sourceFile, compiler });
	const bare: string[] = [];

	for (const statement of sourceFile.statements) {
		const isExported = (compiler.canHaveModifiers(statement) ? (compiler.getModifiers(statement) ?? []) : []).some(
			(modifier) => modifier.kind === compiler.SyntaxKind.ExportKeyword,
		);

		if (compiler.isTypeAliasDeclaration(statement) && isExported && isStringLiteralUnion({ node: statement, compiler })) {
			const name = statement.name.text;

			if (!constNames.has(name)) {
				bare.push(name);
			}
		}
	}

	return bare;
};

/** One finding per file: the remedy is to write the `const` object and derive the union from it, which is one edit to that file. */
const buildFileFindings = ({ input }: { input: SyntaxTreeInput }) => {
	const findings: RawStandardsFinding[] = [];

	for (const [path, tree] of input.trees) {
		const bare = getBareUnions({ sourceFile: tree, compiler: input.compiler });

		if (bare.length > 0) {
			findings.push(
				buildRawFinding({
					rule: 'bare-string-union',
					files: [{ path }],
					detail: bare.map((name) => `type '${name}' is a bare string union`).join('; '),
					guidance: 'Declare the values as an `as const` object and derive the union from it, so consumers reference members instead of literals.',
				}),
			);
		}
	}

	return findings;
};

export const check: StandardsCheckModule = {
	inputKind: 'syntax-tree',
	// A union of literals and a union derived from a `const` object are the same
	// type by the time anything else can see them; only the declaration says
	// which one was written.
	run: ({ input }): RawStandardsFinding[] => (input.kind === 'syntax-tree' ? buildFileFindings({ input }) : []),
};
