import type { RawStandardsFinding, StandardsCheckModule, SyntaxTreeInput } from '@lightsout/standards-contracts';
import type ts from 'typescript';
import { buildRawFinding } from '../../../../../common/utils/buildRawFinding.ts';

/** PascalCase as the table spells it: an uppercase first letter and nothing but letters and digits after it. */
const pascalCase = /^[A-Z][A-Za-z0-9]*$/;

/** An underscore between two alphanumerics — snake_case or SCREAMING_SNAKE_CASE, which no row of the table permits. */
const snakeCase = /[A-Za-z0-9]_[A-Za-z0-9]/;

/** The three declarations the table pins to PascalCase, with the word a finding calls each one. */
const getTypeDeclaration = ({ node, compiler }: { node: ts.Node; compiler: typeof ts }): { kind: string; name: string } | undefined => {
	let found: { kind: string; name: string } | undefined;

	if (compiler.isClassDeclaration(node) && node.name !== undefined) {
		found = { kind: 'class', name: node.name.text };
	}

	if (compiler.isInterfaceDeclaration(node)) {
		found = { kind: 'interface', name: node.name.text };
	}

	if (compiler.isTypeAliasDeclaration(node)) {
		found = { kind: 'type', name: node.name.text };
	}

	return found;
};

/** A variable or function name, wherever in the file it is declared. */
const getValueName = ({ node, compiler }: { node: ts.Node; compiler: typeof ts }) => {
	const named = compiler.isVariableDeclaration(node) || compiler.isFunctionDeclaration(node) ? node.name : undefined;

	return named !== undefined && compiler.isIdentifier(named) ? named.text : undefined;
};

/**
 * The names in one file the table rules out.
 *
 * Only the two unambiguous halves are judged. A class, interface or type alias
 * whose name does not start with a capital is wrong under every row, and an
 * underscore inside any name is wrong under all of them at once. The PascalCase
 * side of the value rows is deliberately left alone: a capitalized `const` is a
 * React component or a named constant as often as it is a mistake, and the
 * table alone cannot tell which.
 */
const getCasingProblems = ({ sourceFile, compiler }: { sourceFile: ts.SourceFile; compiler: typeof ts }) => {
	const problems: string[] = [];

	const visit = (node: ts.Node) => {
		const declared = getTypeDeclaration({ node, compiler });
		const valueName = getValueName({ node, compiler });

		if (declared !== undefined && !pascalCase.test(declared.name)) {
			problems.push(`${declared.kind} '${declared.name}' is not PascalCase`);
		}

		if (valueName !== undefined && snakeCase.test(valueName)) {
			problems.push(`'${valueName}' is not camelCase`);
		}

		node.forEachChild(visit);
	};

	visit(sourceFile);

	return problems;
};

/** One finding per file: renaming is one pass over the file and its callers, not a job per name. */
const buildFileFindings = ({ input }: { input: SyntaxTreeInput }) => {
	const findings: RawStandardsFinding[] = [];

	for (const [path, tree] of input.trees) {
		const problems = getCasingProblems({ sourceFile: tree, compiler: input.compiler });

		if (problems.length > 0) {
			findings.push(
				buildRawFinding({
					rule: 'casing',
					files: [{ path }],
					detail: problems.join('; '),
					guidance: 'Rename to the casing its row of the table gives — types PascalCase, values camelCase.',
				}),
			);
		}
	}

	return findings;
};

export const check: StandardsCheckModule = {
	inputKind: 'syntax-tree',
	// Which casing a name owes depends on what kind of thing it declares, and
	// nothing but the tree says that — the same word reads as a type, a constant
	// or a property depending on where it sits.
	run: ({ input }): RawStandardsFinding[] => (input.kind === 'syntax-tree' ? buildFileFindings({ input }) : []),
};
