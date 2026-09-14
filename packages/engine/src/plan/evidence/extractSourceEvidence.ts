import type ts from 'typescript';

interface Params {
	/** Repo-relative path of the file — only the script flavor is taken from it. */
	path: string;
	content: string;
	/** The consumer's TypeScript module (resolveConsumerTypescript). */
	compiler: typeof ts;
}

/** Every name a top-level statement introduces — a variable statement can introduce several, an import none. */
const declaredNames = ({ statement, compiler }: { statement: ts.Statement; compiler: typeof ts }) => {
	if (compiler.isVariableStatement(statement)) {
		return statement.declarationList.declarations
			.map((declaration) => declaration.name)
			.filter(compiler.isIdentifier)
			.map((name) => name.text);
	}

	if (
		compiler.isFunctionDeclaration(statement) ||
		compiler.isClassDeclaration(statement) ||
		compiler.isInterfaceDeclaration(statement) ||
		compiler.isTypeAliasDeclaration(statement) ||
		compiler.isEnumDeclaration(statement) ||
		compiler.isModuleDeclaration(statement)
	) {
		return statement.name === undefined || !compiler.isIdentifier(statement.name) ? [] : [statement.name.text];
	}

	return [];
};

/** Whether a top-level statement publishes something — an export modifier, or an export statement in its own right. */
const isExported = ({ statement, compiler }: { statement: ts.Statement; compiler: typeof ts }) => {
	if (compiler.isExportDeclaration(statement) || compiler.isExportAssignment(statement)) {
		return true;
	}

	return (
		compiler.canHaveModifiers(statement) && (compiler.getModifiers(statement) ?? []).some((modifier) => modifier.kind === compiler.SyntaxKind.ExportKeyword)
	);
};

/** A name matched as a whole word, so `padding2` never counts as a reference to `padding`. */
const isReferencedIn = ({ text, name }: { text: string; name: string }) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text);

/**
 * Reduce one oversized source file to the definitions a plan writer needs, using
 * the consumer's own compiler.
 *
 * The kept set is exactly three rules, applied in order: every import
 * declaration; every top-level statement that exports something, taken with its
 * leading comment trivia so a documented export arrives with its docblock; and
 * then every remaining top-level declaration whose name appears as a whole word
 * in what has been kept so far, repeated until the kept set stops growing — that
 * last pass is what keeps a `Params` interface and a private helper with the
 * export that needs them.
 *
 * Line ranges and regular expressions over them are deliberately not the
 * mechanism: line numbers are hints rather than durable identity, and an
 * offset-based extractor would reintroduce exactly that brittleness.
 *
 * Content the compiler reads as no top-level statements comes back whole, so
 * unreadable input degrades to full text rather than to an empty brief.
 *
 * Pure and synchronous: no disk, no clock, no config. A caller re-running it
 * over the same bytes must get the same answer, or hash-keyed reuse means
 * nothing.
 */
export const extractSourceEvidence = ({ path, content, compiler }: Params): { text: string; definitions: string[] } => {
	const scriptKind = /\.tsx$/.test(path) ? compiler.ScriptKind.TSX : compiler.ScriptKind.TS;
	const source = compiler.createSourceFile(path, content, compiler.ScriptTarget.Latest, false, scriptKind);
	const statements = [...source.statements];

	if (statements.length === 0) {
		return { text: content, definitions: [] };
	}

	const entries = statements.map((statement) => ({
		statement,
		text: content.slice(statement.pos, statement.end).trim(),
		names: declaredNames({ statement, compiler }),
		kept: compiler.isImportDeclaration(statement) || compiler.isImportEqualsDeclaration(statement) || isExported({ statement, compiler }),
	}));

	let growing = true;

	while (growing) {
		const keptText = entries
			.filter((entry) => entry.kept)
			.map((entry) => entry.text)
			.join('\n\n');

		growing = false;

		for (const entry of entries) {
			if (entry.kept || !entry.names.some((name) => isReferencedIn({ text: keptText, name }))) {
				continue;
			}

			entry.kept = true;
			growing = true;
		}
	}

	const kept = entries.filter((entry) => entry.kept);

	return { text: kept.map((entry) => entry.text).join('\n\n'), definitions: kept.flatMap((entry) => entry.names) };
};
