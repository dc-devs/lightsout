import type ts from 'typescript';
import { isDelegationForwardBody } from '#src/standardsCheck/common/utils/isDelegationForwardBody.ts';

interface Params {
	/** Repo-relative path, only to name the parsed file. */
	path: string;
	/** The file's text, imports already blanked. */
	text: string;
	/** The consumer's TypeScript. */
	compiler: typeof ts;
}

/** Whether a constructor does nothing but store its parameters on `this` — the other half of the composition remedy's shape. */
const isAssigningConstructor = ({ node, compiler }: { node: ts.ConstructorDeclaration; compiler: typeof ts }) =>
	node.body?.statements.every(
		(statement) =>
			compiler.isExpressionStatement(statement) &&
			compiler.isBinaryExpression(statement.expression) &&
			statement.expression.operatorToken.kind === compiler.SyntaxKind.EqualsToken &&
			compiler.isPropertyAccessExpression(statement.expression.left) &&
			statement.expression.left.expression.kind === compiler.SyntaxKind.ThisKeyword,
	);

/**
 * The composition-over-inheritance remedy blanked out of a file before clone
 * detection, the way import lists already are: a class that holds a shared
 * collaborator and forwards to it through one-line methods repeats that shape
 * in every class holding the same collaborator BY DESIGN — the standards
 * mandate it in place of `extends`. Counting it as duplication reports the
 * remedy as the disease, and did, on every refactor run that touched two run
 * classes.
 *
 * Blanked members: a constructor whose body only stores parameters on `this`,
 * and a method whose body is one forward to a `this`-held field (the shared
 * `isDelegationForwardBody` predicate — the same one the ast-duplicate rule
 * consults, so the two duplication tiers can never disagree about the exempt
 * shape). Blanking is newline-preserving, so every reported line number stays
 * true. Real logic beside the forwards — a second statement, a computation —
 * keeps its lines and stays a clone candidate.
 */
export const blankDelegationSpans = ({ path, text, compiler }: Params): string => {
	const sourceFile = compiler.createSourceFile(path, text, compiler.ScriptTarget.Latest, true);
	const lines = text.split('\n');
	const blank = ({ node }: { node: ts.Node }) => {
		const start = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line;
		const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line;

		for (let line = start; line <= end; line += 1) {
			lines[line] = '';
		}
	};

	const visit = (node: ts.Node) => {
		if (compiler.isClassDeclaration(node) || compiler.isClassExpression(node)) {
			for (const member of node.members) {
				if (compiler.isConstructorDeclaration(member) && isAssigningConstructor({ node: member, compiler })) {
					blank({ node: member });
				}

				if (compiler.isMethodDeclaration(member) && member.body !== undefined && isDelegationForwardBody({ body: member.body, compiler })) {
					blank({ node: member });
				}
			}
		}

		node.forEachChild(visit);
	};

	visit(sourceFile);

	return lines.join('\n');
};
