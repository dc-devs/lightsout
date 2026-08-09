import { expect, describe, test } from '@jest/globals';
import { resolveConsumerTypescript } from '@/common/utils/resolveConsumerTypescript';
import { collectFunctionNodes } from './collectFunctionNodes.ts';

/** A declaration on lines 1–3 and an arrow assigned to a variable on lines 5–7. */
const declarationAndArrow = `export function greet({ name }: { name: string }) {
	return name;
}

export const shout = ({ name }: { name: string }) => {
	return greet({ name }).toUpperCase();
};
`;

/** A method on lines 2–4 and a function expression on lines 7–9. */
const methodAndFunctionExpression = `export class Renderer {
	render({ text }: { text: string }) {
		return text;
	}
}

export const wrap = function ({ text }: { text: string }) {
	return text;
};
`;

/** An outer arrow on lines 1–5 wrapping a callback on lines 2–4. */
const nestedCallback = `export const runAll = ({ steps }: { steps: number[] }) => {
	steps.forEach((step) => {
		return step;
	});
};
`;

/** Two overload signatures with no body, then the implementation on lines 3–5. */
const overloadedFunction = `export function parse(input: string): number;
export function parse(input: number): number;
export function parse(input: string | number): number {
	return Number(input);
}
`;

/**
 * One parsed file, as the syntax-tree input holds it: parsed with the compiler
 * the consumer's repo supplies, with parents set so a name can be read off the
 * variable a function is assigned to.
 */
const setupSourceFile = ({ text }: { text: string }) => {
	const compiler = resolveConsumerTypescript({ cwd: process.cwd() });

	if (compiler === undefined) {
		throw new Error('the repo running this suite must have a typescript to borrow');
	}

	return { sourceFile: compiler.createSourceFile('src/subject.ts', text, compiler.ScriptTarget.Latest, true), compiler };
};

describe('collectFunctionNodes', () => {
	test('collects a declaration and an assigned arrow, each over the 1-based lines it spans', () => {
		const { sourceFile, compiler } = setupSourceFile({ text: declarationAndArrow });

		const nodes = collectFunctionNodes({ sourceFile, compiler });

		expect(nodes.map(({ name, startLine, endLine }) => ({ name, startLine, endLine }))).toStrictEqual([
			{ name: 'greet', startLine: 1, endLine: 3 },
			{ name: 'shout', startLine: 5, endLine: 7 },
		]);
	});

	test('a method and a function expression are function-like too', () => {
		const { sourceFile, compiler } = setupSourceFile({ text: methodAndFunctionExpression });

		const nodes = collectFunctionNodes({ sourceFile, compiler });

		expect(nodes.map(({ name, startLine, endLine }) => ({ name, startLine, endLine }))).toStrictEqual([
			{ name: 'render', startLine: 2, endLine: 4 },
			{ name: 'wrap', startLine: 7, endLine: 9 },
		]);
	});

	test('a nested callback is collected as well, reporting under the name nobody gave it', () => {
		const { sourceFile, compiler } = setupSourceFile({ text: nestedCallback });

		const nodes = collectFunctionNodes({ sourceFile, compiler });

		expect(nodes.map(({ name, startLine, endLine }) => ({ name, startLine, endLine }))).toStrictEqual([
			{ name: 'runAll', startLine: 1, endLine: 5 },
			{ name: '(anonymous)', startLine: 2, endLine: 4 },
		]);
	});

	test('an overload signature has no body to measure, so only the implementation is collected', () => {
		const { sourceFile, compiler } = setupSourceFile({ text: overloadedFunction });

		const nodes = collectFunctionNodes({ sourceFile, compiler });

		expect(nodes.map(({ name, startLine, endLine }) => ({ name, startLine, endLine }))).toStrictEqual([{ name: 'parse', startLine: 3, endLine: 5 }]);
	});

	test.each([
		{ label: 'a block', text: 'export function greet({ name }: { name: string }) {\n\treturn name;\n}\n', expected: '{\n\treturn name;\n}' },
		{ label: 'the single expression an arrow returns', text: 'export const double = ({ amount }: { amount: number }) => amount * 2;\n', expected: 'amount * 2' },
	])('hands the rule $label as the body it reads', ({ text, expected }) => {
		const { sourceFile, compiler } = setupSourceFile({ text });

		const nodes = collectFunctionNodes({ sourceFile, compiler });

		expect(nodes[0]?.body.getText()).toBe(expected);
	});

	test('a file holding no function at all yields nothing', () => {
		const { sourceFile, compiler } = setupSourceFile({ text: 'export const total = 1 + 2;\n' });

		const nodes = collectFunctionNodes({ sourceFile, compiler });

		expect(nodes).toStrictEqual([]);
	});

	test('a constructor is outside the four kinds the walk collects', () => {
		const { sourceFile, compiler } = setupSourceFile({ text: 'export class Ledger {\n\ttotal = 0;\n\n\tconstructor() {\n\t\tthis.total = 1;\n\t}\n}\n' });

		const nodes = collectFunctionNodes({ sourceFile, compiler });

		expect(nodes).toStrictEqual([]);
	});
});
