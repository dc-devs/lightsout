import type ts from 'typescript';

interface Params {
	/** Repo-relative path — the extension picks the parse flavor (.tsx/.jsx need JSX). */
	path: string;
	content: string;
	/** The consumer's TypeScript module (resolveConsumerTypescript) — parses its JS/TS dialects. */
	compiler: typeof ts;
}

/**
 * Whether a node holds an `await` belonging to module scope. Function and
 * class bodies open their own scope, so the search stops at them: an `await`
 * inside one is ordinary async code.
 */
const hasModuleScopeAwait = ({ node, compiler }: { node: ts.Node; compiler: typeof ts }): boolean => {
	if (compiler.isFunctionLike(node) || compiler.isClassLike(node)) {
		return false;
	}

	// `for await (… of …)` carries its await on the statement, not as an expression.
	if (compiler.isAwaitExpression(node) || (compiler.isForOfStatement(node) && node.awaitModifier !== undefined)) {
		return true;
	}

	return node.forEachChild((child) => hasModuleScopeAwait({ node: child, compiler })) === true;
};

/**
 * True when the file carries an `await` at module scope — a statement that is
 * legal only where the module system evaluates the file as an ES module, and a
 * syntax error anywhere it is evaluated as CommonJS.
 *
 * Whether the consumer's own runner evaluates it either way is not this
 * predicate's question: it reads syntax and nothing else. The coverage module's
 * `selectUnloadableFiles` answers the runner half, by reading the Jest
 * configuration governing the file's coverage scope.
 *
 * Deliberately narrow: an `await` inside any function or class body is
 * ordinary async code and says nothing about whether the file loads.
 */
export const isUnloadableSourceFile = ({ path, content, compiler }: Params): boolean => {
	const scriptKind = /\.[jt]sx$/.test(path) ? compiler.ScriptKind.TSX : compiler.ScriptKind.TS;
	const source = compiler.createSourceFile(path, content, compiler.ScriptTarget.Latest, false, scriptKind);

	return source.statements.some((statement) => hasModuleScopeAwait({ node: statement, compiler }));
};
