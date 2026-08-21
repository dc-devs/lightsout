import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import type ts from 'typescript';
import { buildRawFinding } from '../../../../../common/findings/buildRawFinding.ts';

/** The 1-based line a node starts on. */
const lineOf = ({ sourceFile, node }: { sourceFile: ts.SourceFile; node: ts.Node }) => sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

/**
 * Every `as const` object in the run, as the strings it holds keyed by the name
 * it is declared under.
 *
 * Read across all trees rather than per file, because the object and the
 * consumer that should reference it are almost never the same file — the whole
 * cost the rule names is paid at the narrowing site, one import away.
 */
const readConstObjects = ({ trees, compiler }: { trees: Map<string, ts.SourceFile>; compiler: typeof ts }) => {
	const byName = new Map<string, Set<string>>();

	for (const tree of trees.values()) {
		const visit = (node: ts.Node) => {
			if (compiler.isVariableDeclaration(node) && compiler.isIdentifier(node.name) && node.initializer !== undefined) {
				const init = node.initializer;
				const frozen = compiler.isAsExpression(init) && compiler.isTypeReferenceNode(init.type) && init.type.typeName.getText() === 'const';

				if (frozen && compiler.isObjectLiteralExpression(init.expression)) {
					const values = init.expression.properties
						.filter((property): property is ts.PropertyAssignment => compiler.isPropertyAssignment(property))
						.map((property) => property.initializer)
						.filter((value): value is ts.StringLiteral => compiler.isStringLiteral(value))
						.map((value) => value.text);

					byName.set(node.name.text, new Set([...(byName.get(node.name.text) ?? []), ...values]));
				}
			}

			node.forEachChild(visit);
		};

		visit(tree);
	}

	return byName;
};

/** The names a file can reach without qualifying them — what it imports, plus what it declares. */
const namesInScope = ({ sourceFile, compiler }: { sourceFile: ts.SourceFile; compiler: typeof ts }) => {
	const names = new Set<string>();

	const visit = (node: ts.Node) => {
		if (compiler.isImportSpecifier(node) || (compiler.isVariableDeclaration(node) && compiler.isIdentifier(node.name))) {
			names.add(node.name.getText());
		}

		node.forEachChild(visit);
	};

	visit(sourceFile);

	return names;
};

/** Lines where a field is typed as a bare string literal — the declaration half of the rule. */
const declarationLines = ({ sourceFile, compiler }: { sourceFile: ts.SourceFile; compiler: typeof ts }) => {
	const lines: number[] = [];

	const visit = (node: ts.Node) => {
		if (compiler.isPropertySignature(node) && node.type !== undefined && compiler.isLiteralTypeNode(node.type) && compiler.isStringLiteral(node.type.literal)) {
			lines.push(lineOf({ sourceFile, node }));
		}

		node.forEachChild(visit);
	};

	visit(sourceFile);

	return lines;
};

/**
 * Lines narrowing a field against a raw string literal that a `const` object in
 * scope already holds — the narrowing half, and the half the rule's own prose
 * is about: "otherwise consumers retype the literal at every narrowing site".
 *
 * Both ways of narrowing count. `event.kind === 'file-added'` and
 * `switch (event.kind) { case 'file-added': }` retype the same literal, and a
 * rule that saw only the first would send an agent to fix an `if` and walk past
 * the switch beneath it.
 *
 * The object has to be in scope for the file to be at fault. A literal that
 * merely happens to match some unrelated object elsewhere in the repo is not a
 * retyped discriminant, and reporting it would make the rule guess.
 */
const comparisonLines = ({
	sourceFile,
	compiler,
	constObjects,
}: {
	sourceFile: ts.SourceFile;
	compiler: typeof ts;
	constObjects: Map<string, Set<string>>;
}) => {
	const scope = namesInScope({ sourceFile, compiler });
	const held = new Set([...constObjects].filter(([name]) => scope.has(name)).flatMap(([, values]) => [...values]));
	const lines: number[] = [];

	const visit = (node: ts.Node) => {
		if (compiler.isBinaryExpression(node)) {
			const equality =
				node.operatorToken.kind === compiler.SyntaxKind.EqualsEqualsEqualsToken || node.operatorToken.kind === compiler.SyntaxKind.ExclamationEqualsEqualsToken;
			const sides = [node.left, node.right];
			const literal = sides.find((side) => compiler.isStringLiteral(side));
			const accessed = sides.some((side) => compiler.isPropertyAccessExpression(side));

			if (equality && accessed && literal !== undefined && compiler.isStringLiteral(literal) && held.has(literal.text)) {
				lines.push(lineOf({ sourceFile, node }));
			}
		}

		// A case clause is the same narrowing spelled the other way. The switch it
		// belongs to is two nodes up — clause, block, statement — and its subject
		// has to be a field for the literal to be a discriminant rather than any
		// string this file happens to switch on.
		if (compiler.isCaseClause(node) && compiler.isStringLiteral(node.expression) && held.has(node.expression.text)) {
			const block = node.parent;
			const statement = block?.parent;

			if (statement !== undefined && compiler.isSwitchStatement(statement) && compiler.isPropertyAccessExpression(statement.expression)) {
				lines.push(lineOf({ sourceFile, node }));
			}
		}

		node.forEachChild(visit);
	};

	visit(sourceFile);

	return lines;
};

/** Completes "…at line 3" / "…at lines 3, 7". */
const at = ({ lines }: { lines: number[] }) => `at ${lines.length > 1 ? 'lines' : 'line'} ${lines.join(', ')}`;

// Read from the tree rather than the text: `kind: 'file-added'` and a default
// value spelled the same way are the same characters and different things, and
// only the tree says which is a type position.
export const check: StandardsCheckModule = {
	inputKind: 'syntax-tree',
	run: ({ input }): RawStandardsFinding[] => {
		if (input.kind !== 'syntax-tree') {
			return [];
		}

		const constObjects = readConstObjects({ trees: input.trees, compiler: input.compiler });
		const findings: RawStandardsFinding[] = [];

		for (const [path, sourceFile] of input.trees) {
			const declarations = declarationLines({ sourceFile, compiler: input.compiler });
			const comparisons = comparisonLines({ sourceFile, compiler: input.compiler, constObjects });
			const detail = [
				...(declarations.length > 0 ? [`field typed as a raw string literal ${at({ lines: declarations })}`] : []),
				...(comparisons.length > 0 ? [`discriminant compared against a raw string literal ${at({ lines: comparisons })}`] : []),
			].join('; ');

			if (detail !== '') {
				findings.push(
					buildRawFinding({
						rule: 'discriminant-const-object',
						files: [{ path }],
						detail,
						guidance: "Reference the family's `const` object — `kind: typeof SyncEventKind.FileAdded`, and `SyncEventKind.FileAdded` at every narrowing site.",
					}),
				);
			}
		}

		return findings;
	},
};
