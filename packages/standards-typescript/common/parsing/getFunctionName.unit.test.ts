import { describe, expect, test } from '@jest/globals';
import ts from 'typescript';
import { getFunctionName } from './getFunctionName.ts';

/** The first function-like node in a snippet — the one every case below is about. */
const findFunctionNode = ({ node, compiler }: { node: ts.Node; compiler: typeof ts }): ts.Node | undefined =>
	compiler.isFunctionDeclaration(node) || compiler.isMethodDeclaration(node) || compiler.isArrowFunction(node) || compiler.isFunctionExpression(node)
		? node
		: compiler.forEachChild(node, (child) => findFunctionNode({ node: child, compiler }));

/**
 * One parsed snippet and the function-like node inside it. Parents are set, as
 * the syntax-tree input sets them — the fallback to the enclosing variable
 * declaration cannot be reached without them.
 */
const setupFunctionNode = ({ text }: { text: string }) => {
	const sourceFile = ts.createSourceFile('src/subject.ts', text, ts.ScriptTarget.Latest, true);
	const node = findFunctionNode({ node: sourceFile, compiler: ts });

	if (node === undefined) {
		throw new Error(`the snippet holds no function-like node: ${text}`);
	}

	return { node, compiler: ts };
};

describe('getFunctionName', () => {
	test.each([
		{ label: 'a function declaration', text: 'export function greet({ name }: { name: string }) {\n\treturn name;\n}\n', expected: 'greet' },
		{ label: 'a method', text: 'export class Renderer {\n\trender({ text }: { text: string }) {\n\t\treturn text;\n\t}\n}\n', expected: 'render' },
	])('reads the name $label declares for itself', ({ text, expected }) => {
		const { node, compiler } = setupFunctionNode({ text });

		const name = getFunctionName({ node, compiler });

		expect(name).toBe(expected);
	});

	test.each([
		{ label: 'an arrow function', text: 'export const formatAmount = ({ amount }: { amount: number }) => amount * 2;\n' },
		{ label: 'a function expression', text: 'export const formatAmount = function ({ amount }: { amount: number }) {\n\treturn amount * 2;\n};\n' },
		{ label: 'a named function expression', text: 'export const formatAmount = function inner({ amount }: { amount: number }) {\n\treturn amount * 2;\n};\n' },
	])('names $label after the variable it is assigned to', ({ text }) => {
		const { node, compiler } = setupFunctionNode({ text });

		const name = getFunctionName({ node, compiler });

		expect(name).toBe('formatAmount');
	});

	test.each([
		{ label: 'a callback nobody named', text: 'export const doubled = [1, 2].map((step) => step * 2);\n' },
		{ label: 'a function held by an object property', text: 'export const handlers = {\n\trun: ({ id }: { id: number }) => id,\n};\n' },
		{ label: 'an unnamed default export', text: 'export default function ({ id }: { id: number }) {\n\treturn id;\n}\n' },
	])('reports $label as (anonymous), which is how a rule that must skip callbacks recognises them', ({ text }) => {
		const { node, compiler } = setupFunctionNode({ text });

		const name = getFunctionName({ node, compiler });

		expect(name).toBe('(anonymous)');
	});
});
