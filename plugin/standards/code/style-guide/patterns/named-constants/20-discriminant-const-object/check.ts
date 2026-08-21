import type { RawStandardsFinding, StandardsCheckModule, TypeCheckerInput } from '@lightsout/standards-contracts';
import type ts from 'typescript';
import { buildRawFinding } from '../../../../../common/findings/buildRawFinding.ts';

/** The 1-based line a node starts on. */
const lineOf = ({ sourceFile, node }: { sourceFile: ts.SourceFile; node: ts.Node }) => sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

/**
 * Every string an `as const` object in the run holds, against the files that
 * declare it.
 *
 * The rule is about a family that HAS a const object — that is what a narrowing
 * site is supposed to reference. Without this the checker alone would call any
 * union of string literals a family, and report every `typeof value === 'string'`
 * guard and every inline literal union in the repo.
 *
 * The declaring paths are kept because reachability decides the rest: a site can
 * only reference an object it is allowed to import.
 */
const readConstStrings = ({ typedFiles, compiler }: { typedFiles: TypeCheckerInput['typedFiles']; compiler: typeof ts }) => {
	const strings = new Map<string, Set<string>>();

	for (const [declaringPath, { sourceFile }] of typedFiles) {
		const visit = (node: ts.Node) => {
			if (compiler.isVariableDeclaration(node) && node.initializer !== undefined) {
				const init = node.initializer;
				const frozen = compiler.isAsExpression(init) && compiler.isTypeReferenceNode(init.type) && init.type.typeName.getText() === 'const';

				if (frozen && compiler.isObjectLiteralExpression(init.expression)) {
					for (const property of init.expression.properties) {
						if (compiler.isPropertyAssignment(property) && compiler.isStringLiteral(property.initializer)) {
							const value = property.initializer.text;

							strings.set(value, new Set([...(strings.get(value) ?? []), declaringPath]));
						}
					}
				}
			}

			node.forEachChild(visit);
		};

		visit(sourceFile);
	}

	return strings;
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
 * The standards package a path sits inside, or undefined for ordinary source.
 *
 * A rule's check ships as a bare directory beside the engine, with no manifest
 * and no `node_modules`, so every VALUE it imports has to resolve inside its own
 * package. A discriminant declared anywhere else is a value it may not name —
 * which is why every `check.ts` in the world writes `input.kind !== 'syntax-tree'`
 * with the literal spelled out, and why doing so is not this rule's finding.
 */
const packageOf = ({ path, standardsPackages }: { path: string; standardsPackages: string[] }) => standardsPackages.find((root) => path.startsWith(`${root}/`));

/**
 * The family a compared expression belongs to, when it belongs to one: the name
 * of its declared type, and the strings that type admits.
 *
 * This is the question only a checker can answer. The expression's DECLARED
 * type is what says whether a literal is a discriminant, and that declaration
 * is almost never in the file doing the comparing — the whole cost the rule
 * names is paid one import away. A type that is a string literal, or a union of
 * them, is a family; `string` is not, and neither is anything else.
 */
const readFamily = ({ node, checker }: { node: ts.Expression; checker: ts.TypeChecker }) => {
	const type = checker.getTypeAtLocation(node);
	const parts = type.isUnion() ? type.types : [type];
	const members = parts.filter((part) => part.isStringLiteral()).map((part) => part.value);

	// Every part has to be a literal. A union of a literal and `string` widens to
	// `string` for narrowing purposes, and calling that a family would flag an
	// ordinary string comparison that happens to match one member.
	return members.length === 0 || members.length !== parts.length
		? undefined
		: { name: type.aliasSymbol?.getName() ?? checker.typeToString(type), members: new Set(members) };
};

/**
 * Lines narrowing a field against a raw string literal its own declared type
 * already names — the narrowing half, and the half the rule's prose is about:
 * "otherwise consumers retype the literal at every narrowing site".
 *
 * Both ways of narrowing count. `event.kind === 'file-added'` and
 * `switch (event.kind) { case 'file-added': }` retype the same literal, and a
 * rule that saw only the first would send an agent to fix an `if` and walk past
 * the switch beneath it.
 */
const narrowingSites = ({
	sourceFile,
	checker,
	compiler,
	constStrings,
	reachable,
}: {
	sourceFile: ts.SourceFile;
	checker: ts.TypeChecker;
	compiler: typeof ts;
	constStrings: Map<string, Set<string>>;
	/** Whether the file may import a const object declared at this path. */
	reachable: (params: { declaringPath: string }) => boolean;
}) => {
	const sites: Array<{ line: number; family: string }> = [];

	const record = ({ node, subject, literal }: { node: ts.Node; subject: ts.Expression; literal: ts.StringLiteral }) => {
		// `typeof value === 'string'` types as the operator's own eight-member
		// union. It is a type guard, not a family a const object stands behind.
		const declaredIn = compiler.isTypeOfExpression(subject) ? undefined : constStrings.get(literal.text);

		if (declaredIn === undefined || ![...declaredIn].some((declaringPath) => reachable({ declaringPath }))) {
			return;
		}

		const family = readFamily({ node: subject, checker });

		if (family?.members.has(literal.text)) {
			sites.push({ line: lineOf({ sourceFile, node }), family: family.name });
		}
	};

	const visit = (node: ts.Node) => {
		if (compiler.isBinaryExpression(node)) {
			const equality =
				node.operatorToken.kind === compiler.SyntaxKind.EqualsEqualsEqualsToken || node.operatorToken.kind === compiler.SyntaxKind.ExclamationEqualsEqualsToken;
			const literal = [node.left, node.right].find((side) => compiler.isStringLiteral(side));
			const subject = literal === node.left ? node.right : node.left;

			if (equality && literal !== undefined && compiler.isStringLiteral(literal)) {
				record({ node, subject, literal });
			}
		}

		// A case clause is the same narrowing spelled the other way. The switch it
		// belongs to is two nodes up — clause, block, statement.
		if (compiler.isCaseClause(node) && compiler.isStringLiteral(node.expression)) {
			const statement = node.parent?.parent;

			if (statement !== undefined && compiler.isSwitchStatement(statement)) {
				record({ node, subject: statement.expression, literal: node.expression });
			}
		}

		node.forEachChild(visit);
	};

	visit(sourceFile);

	return sites;
};

/** Completes "…at line 3" / "…at lines 3, 7". */
const at = ({ lines }: { lines: number[] }) => `at ${lines.length > 1 ? 'lines' : 'line'} ${lines.join(', ')}`;

// Asks for the checker, not just the tree. The declaration half is decidable
// from syntax alone — `kind: 'file-added'` and a default value spelled the same
// way differ only by position — but the narrowing half is not: whether a
// compared literal is a discriminant depends on the DECLARED type of the thing
// it is compared against, which lives in another file.
export const check: StandardsCheckModule = {
	inputKind: 'type-checker',
	run: ({ input }): RawStandardsFinding[] => {
		if (input.kind !== 'type-checker') {
			return [];
		}

		const constStrings = readConstStrings({ typedFiles: input.typedFiles, compiler: input.compiler });
		const findings: RawStandardsFinding[] = [];

		// Reported on source only. `typedFiles` also carries tests and files
		// outside the run's scope, because the evidence above needs them typed —
		// but a test narrowing a string is the test's own business, and a file
		// nobody asked about is not this run's to report.
		for (const path of input.source) {
			const typed = input.typedFiles.get(path);

			if (typed === undefined) {
				continue;
			}

			const { sourceFile, checker } = typed;
			const home = packageOf({ path, standardsPackages: input.standardsPackages });
			const declarations = declarationLines({ sourceFile, compiler: input.compiler });
			const narrowings = narrowingSites({
				sourceFile,
				checker,
				compiler: input.compiler,
				constStrings,
				reachable: ({ declaringPath }) => home === undefined || packageOf({ path: declaringPath, standardsPackages: input.standardsPackages }) === home,
			});
			const families = [...new Set(narrowings.map((site) => site.family))];
			const detail = [
				...(declarations.length > 0 ? [`field typed as a raw string literal ${at({ lines: declarations })}`] : []),
				...(narrowings.length > 0
					? [`${families.join(', ')} narrowed against a raw string literal ${at({ lines: narrowings.map((site) => site.line) })}`]
					: []),
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
