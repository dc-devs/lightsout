import type { RawStandardsFinding, StandardsCheckModule, SyntaxTreeInput } from '@lightsout/standards-contracts';
import type ts from 'typescript';
import { buildRawFinding } from '../../../../../common/findings/buildRawFinding.ts';

/** Whether a statement carries the `export` keyword — the bright line the rule is drawn on. */
const isExported = ({ statement, compiler }: { statement: ts.Statement; compiler: typeof ts }) =>
	(compiler.canHaveModifiers(statement) ? (compiler.getModifiers(statement) ?? []) : []).some(
		(modifier) => modifier.kind === compiler.SyntaxKind.ExportKeyword,
	);

/**
 * The exported functions in one file that state no return type, by the two
 * shapes an export is written in: `export const name = () => …` and
 * `export function name() …`.
 *
 * Only top-level statements are read. A function nested inside another is not
 * exported whatever it looks like, and the rule is about the file's public
 * contract.
 *
 * Two of the document's four exceptions are decided here. A generic signature
 * is left alone — the type parameters are the contract, and the written return
 * type is the unreadable expression the exception describes. An arrow whose
 * variable is annotated is interface-pinned: the contract is already declared,
 * one line above. The other two — framework components, and query-options
 * factories — are decided by the caller, which judges only the files an
 * annotation belongs in.
 */
const getUnannotated = ({ sourceFile, compiler }: { sourceFile: ts.SourceFile; compiler: typeof ts }) => {
	const missing: string[] = [];

	for (const statement of sourceFile.statements) {
		if (!isExported({ statement, compiler })) {
			continue;
		}

		if (compiler.isFunctionDeclaration(statement) && statement.name !== undefined && statement.type === undefined && statement.typeParameters === undefined) {
			missing.push(statement.name.text);
		}

		if (compiler.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				const initializer = declaration.initializer;
				const isPlainArrow =
					initializer !== undefined &&
					(compiler.isArrowFunction(initializer) || compiler.isFunctionExpression(initializer)) &&
					initializer.type === undefined &&
					initializer.typeParameters === undefined;

				if (isPlainArrow && declaration.type === undefined && compiler.isIdentifier(declaration.name)) {
					missing.push(declaration.name.text);
				}
			}
		}
	}

	return missing;
};

/** A file under a `queries/` folder, where the document's fourth exception puts the query-options factories. */
const isQueryOptionsFactory = ({ path }: { path: string }) => path.split('/').slice(0, -1).includes('queries');

/**
 * A file this rule can ask anything of: one where a return type annotation is
 * syntax that exists, and where the document asks for one.
 *
 * Named as an allow-list rather than a list of extensions to skip. `.tsx` is
 * the document's own first exception — framework components live there.
 * JavaScript is a harder no: `.js`, `.mjs` and friends have no syntax for the
 * annotation this rule demands, so every hit would be a finding nobody could
 * fix, and a burn-down would stall on work that cannot be done. These standards
 * deliberately run at full strength on JavaScript-only repos, which is exactly
 * why a TypeScript-only rule has to state its own scope instead of assuming it.
 *
 * A `queries/` folder is the fourth exception, decided by path for the same
 * reason `.tsx` is: what makes a query-options factory its own contract is the
 * inferred `queryOptions` type, and that is not a fact the declaration's syntax
 * shows.
 */
const isAnnotatable = ({ path }: { path: string }) => /\.(ts|mts|cts)$/.test(path) && !isQueryOptionsFactory({ path });

/** One finding per file: annotating the exports of a file is one pass through it. */
const buildFileFindings = ({ input }: { input: SyntaxTreeInput }) => {
	const findings: RawStandardsFinding[] = [];

	for (const [path, tree] of input.trees) {
		const missing = isAnnotatable({ path }) ? getUnannotated({ sourceFile: tree, compiler: input.compiler }) : [];

		if (missing.length > 0) {
			findings.push(
				buildRawFinding({
					rule: 'explicit-return-type',
					files: [{ path }],
					detail: missing.map((name) => `exported '${name}' declares no return type`).join('; '),
					guidance: 'Declare the return type — it is the output half of the contract, and it fails at the definition site rather than in a consumer.',
				}),
			);
		}
	}

	return findings;
};

export const check: StandardsCheckModule = {
	inputKind: 'syntax-tree',
	// The annotation's absence is a fact of the declaration, and the two
	// exceptions that survive here — generics and an already-typed variable —
	// are facts of the same node.
	run: ({ input }): RawStandardsFinding[] => (input.kind === 'syntax-tree' ? buildFileFindings({ input }) : []),
};
