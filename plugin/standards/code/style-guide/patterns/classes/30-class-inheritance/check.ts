import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import type ts from 'typescript';
import { buildClassFindings } from '../../../../../common/findings/buildClassFindings.ts';

/**
 * The name a heritage expression ends with: `RunState` from `extends RunState`,
 * `Component` from `extends React.Component`. The last segment is what carries
 * the error-family convention the exemption reads.
 */
const getBaseName = ({ expression, compiler }: { expression: ts.Expression; compiler: typeof ts }): string => {
	if (compiler.isIdentifier(expression)) {
		return expression.text;
	}

	if (compiler.isPropertyAccessExpression(expression)) {
		return expression.name.text;
	}

	if (compiler.isExpressionWithTypeArguments(expression)) {
		return getBaseName({ expression: expression.expression, compiler });
	}

	return expression.getText();
};

/**
 * The banned extension a class declares, or undefined. `implements` is a
 * contract, not inheritance, so only the `extends` clause is read. The Error
 * family is the platform's one licensed base, and a decorated class is
 * framework-owned — the same carve-out its sibling rules apply.
 */
const getBannedExtension = ({ node, compiler }: { node: ts.ClassDeclaration; compiler: typeof ts }) => {
	const isFrameworkOwned = (node.modifiers ?? []).some((modifier) => compiler.isDecorator(modifier));
	const extended = (node.heritageClauses ?? []).find((clause) => clause.token === compiler.SyntaxKind.ExtendsKeyword)?.types[0];

	if (isFrameworkOwned || extended === undefined) {
		return undefined;
	}

	const base = getBaseName({ expression: extended.expression, compiler });

	if (base === 'Error' || base.endsWith('Error')) {
		return undefined;
	}

	const name = node.name === undefined ? '(anonymous)' : node.name.text;

	return `class '${name}' extends '${base}'`;
};

export const check: StandardsCheckModule = {
	inputKind: 'syntax-tree',
	run: ({ input }): RawStandardsFinding[] =>
		input.kind === 'syntax-tree'
			? buildClassFindings({
					input,
					rule: 'class-inheritance',
					guidance:
						'Share by composition: hold the common part as a value and delegate to it, or state the contract as an interface. `extends Error` is the one licensed base; a framework-mandated base is the judgment carve-out.',
					getViolation: getBannedExtension,
				})
			: [],
};
