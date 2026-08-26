import type { RawStandardsFinding, StandardsCheckModule, SyntaxTreeInput } from '@lightsout/standards-contracts';
import type ts from 'typescript';
import { buildRawFinding } from '../../../../../common/findings/buildRawFinding.ts';

/** The leftmost identifier of a type reference's name — `Repository` in `Repository` and in `orm.Repository`, which is the name an import binds. */
const getRootTypeName = ({ name, compiler }: { name: ts.EntityName; compiler: typeof ts }): ts.Identifier =>
	compiler.isIdentifier(name) ? name : getRootTypeName({ name: name.left, compiler });

/** Whether a declaration carries a decorator of its own. */
const isDecorated = ({ node, compiler }: { node: ts.HasDecorators; compiler: typeof ts }) => (compiler.getDecorators(node)?.length ?? 0) > 0;

/**
 * Whether a type reference sits where `emitDecoratorMetadata` emits it as a
 * runtime value — a decorated class's constructor parameters, a decorated
 * method's parameters, a decorated property's type, a decorated method's return
 * type.
 *
 * Those four are exactly the positions the compiler turns into a
 * `design:paramtypes`, `design:type` or `design:returntype` entry, which is how
 * NestJS's dependency injection and its validation pipes read the type at all.
 * Written as `import type` the name erases and the metadata becomes `undefined`
 * — the app breaks at runtime, and nothing in the build says so.
 *
 * Read from the decorator rather than from the tsconfig flag on purpose: a
 * decorated class in a repo without `emitDecoratorMetadata` is vanishingly
 * rare, and the two mistakes are not the same size — the false positive costs a
 * broken app, the false negative one unflagged import.
 *
 * An undecorated member of a decorated class is NOT one of these positions. The
 * line is what the compiler emits metadata for, not the class as a whole.
 */
const isMetadataPosition = ({ reference, compiler }: { reference: ts.TypeReferenceNode; compiler: typeof ts }) => {
	const { parent } = reference;
	// The one test every position below shares — the reference IS the declared
	// type, not something nested inside the declaration — written once, so a
	// fifth position added later cannot be the one that forgets it.
	const declaresThisType =
		(compiler.isParameter(parent) || compiler.isPropertyDeclaration(parent) || compiler.isMethodDeclaration(parent)) && parent.type === reference;
	// `design:paramtypes`: the parameter list of a decorated constructor's class,
	// or of a method decorated itself or through any of its own parameters.
	const owner = compiler.isParameter(parent) ? parent.parent : undefined;
	const emitsParamTypes =
		owner !== undefined &&
		((compiler.isConstructorDeclaration(owner) && isDecorated({ node: owner.parent, compiler })) ||
			(compiler.isMethodDeclaration(owner) &&
				(isDecorated({ node: owner, compiler }) || owner.parameters.some((parameter) => isDecorated({ node: parameter, compiler })))));
	// `design:type` and `design:returntype`: the member itself carries the decorator.
	const emitsMemberType = (compiler.isPropertyDeclaration(parent) || compiler.isMethodDeclaration(parent)) && isDecorated({ node: parent, compiler });

	return declaresThisType && (emitsParamTypes || emitsMemberType);
};

/**
 * Every name the file mentions, split by whether the mention sits inside a type
 * node. The import clause itself is skipped — it binds the names, it does not
 * use them — and `typeof X` counts as a type position, since that is exactly
 * the form `import type` still permits.
 *
 * The one type position that counts as a VALUE use is a reference decorator
 * metadata emits, and only its OUTERMOST reference: the metadata carries the
 * outer constructor and nothing inside it, so `Repository` in
 * `Repository<Event>` is emitted while `Event` erases exactly as it always did.
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

			// `!isType` is what makes this the outermost reference: once inside a type
			// node every descendant carries the flag, so a nested type argument never
			// reaches here.
			if (!isType && compiler.isTypeReferenceNode(node) && isMetadataPosition({ reference: node, compiler })) {
				inValues.add(getRootTypeName({ name: node.typeName, compiler }).text);
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
