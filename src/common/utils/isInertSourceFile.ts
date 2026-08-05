import type ts from 'typescript';

interface Params {
	/** Repo-relative path — the extension picks the parse flavor (.tsx/.jsx need JSX). */
	path: string;
	content: string;
	/** The consumer's TypeScript module (resolveConsumerTypescript) — parses its JS/TS dialects. */
	compiler: typeof ts;
}

/**
 * True only when the file PROVABLY contains no executable statement: every
 * top-level statement is an import, a re-export, or a pure type declaration —
 * i.e. barrels and type-only files, the exact set the test standards exempt
 * from dedicated tests. These never earn a test-writer invocation: there is
 * nothing to cover, and a writer either burns the spawn as a no-op or writes
 * implementation-coupled noise. Conservative by construction — anything else
 * (a constant with a fallback expression, an enum, a class, an
 * export-default) counts as logic and keeps its writer; a false "has logic"
 * merely reproduces the old behavior.
 */
export const isInertSourceFile = ({ path, content, compiler }: Params): boolean => {
	const scriptKind = /\.[jt]sx$/.test(path) ? compiler.ScriptKind.TSX : compiler.ScriptKind.TS;
	const source = compiler.createSourceFile(path, content, compiler.ScriptTarget.Latest, false, scriptKind);

	return source.statements.every(
		(statement) =>
			compiler.isImportDeclaration(statement) ||
			compiler.isExportDeclaration(statement) ||
			compiler.isTypeAliasDeclaration(statement) ||
			compiler.isInterfaceDeclaration(statement),
	);
};
