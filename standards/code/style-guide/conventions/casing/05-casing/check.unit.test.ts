import { expect, describe, test } from '@jest/globals';
import type ts from 'typescript';
import { resolveConsumerTypescript } from '@/common/utils/resolveConsumerTypescript';
import { StandardsInputKind } from '@/contracts';
import type { StandardsCheckInput } from '@/contracts';
import { check } from './check.ts';

/** A repo as the engine hands it to a syntax-tree rule: one parsed tree per source file, plus the compiler it borrowed. */
const setupSyntaxTreeInput = ({ sources }: { sources: Array<[string, string]> }): StandardsCheckInput => {
	const compiler = resolveConsumerTypescript({ cwd: process.cwd() });

	if (compiler === undefined) {
		throw new Error('the repo running this suite must have a typescript to borrow');
	}

	const trees = new Map<string, ts.SourceFile>();

	for (const [path, text] of sources) {
		trees.set(path, compiler.createSourceFile(path, text, compiler.ScriptTarget.Latest, true));
	}

	const paths = sources.map(([path]) => path);

	return { kind: StandardsInputKind.SyntaxTree, cwd: '/repo', source: paths, tests: [], files: paths, referenceFiles: [], compiler, trees };
};

/** The input a rule that did NOT declare `syntax-tree` would receive — an arm the union permits but a run never produces. */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/billing/Invoice.ts'],
	spans: [],
});

const setupOneFile = ({ text }: { text: string }) => setupSyntaxTreeInput({ sources: [['src/billing/Invoice.ts', text]] });

describe('casing check', () => {
	test('asks for parsed trees, since which casing a name owes depends on what it declares', () => {
		expect(check.inputKind).toBe('syntax-tree');
	});

	test('reports an interface whose name does not start with a capital', async () => {
		const input = setupOneFile({ text: 'export interface invoice {\n\tlabel: string;\n}\n' });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'casing:src/billing/Invoice.ts',
				files: [{ path: 'src/billing/Invoice.ts' }],
				detail: "interface 'invoice' is not PascalCase",
				guidance: 'Rename to the casing its row of the table gives — types PascalCase, values camelCase.',
			},
		]);
	});

	test.each([
		{ kind: 'class', text: 'export class userService {}', expected: "class 'userService' is not PascalCase" },
		{ kind: 'type', text: 'export type userId = string;', expected: "type 'userId' is not PascalCase" },
		{ kind: 'interface with an underscore', text: 'export interface User_Profile {\n\tname: string;\n}\n', expected: "interface 'User_Profile' is not PascalCase" },
	])('reports a $kind the table pins to PascalCase', async ({ text, expected }) => {
		const input = setupOneFile({ text });

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe(expected);
	});

	test.each([
		{ shape: 'a SCREAMING_SNAKE_CASE constant', text: 'export const MAX_RETRIES = 10;', expected: "'MAX_RETRIES' is not camelCase" },
		{ shape: 'a snake_case variable', text: 'export const user_name = "ada";', expected: "'user_name' is not camelCase" },
		{ shape: 'a snake_case function', text: 'export function get_user_name(): string {\n\treturn "ada";\n}\n', expected: "'get_user_name' is not camelCase" },
	])('reports $shape', async ({ text, expected }) => {
		const input = setupOneFile({ text });

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe(expected);
	});

	test('gathers every misnamed declaration of one file into one job', async () => {
		const input = setupOneFile({ text: ['export interface invoice {', '\tlabel: string;', '}', '', 'export const MAX_RETRIES = 10;'].join('\n') });

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("interface 'invoice' is not PascalCase; 'MAX_RETRIES' is not camelCase");
	});

	test('raises one job per file, since renaming is a pass over one file and its callers', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/billing/invoice.ts', 'export interface invoice {\n\tlabel: string;\n}\n'],
				['src/billing/maxRetries.ts', 'export const MAX_RETRIES = 10;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'casing:src/billing/invoice.ts',
				files: [{ path: 'src/billing/invoice.ts' }],
				detail: "interface 'invoice' is not PascalCase",
				guidance: 'Rename to the casing its row of the table gives — types PascalCase, values camelCase.',
			},
			{
				siteKey: 'casing:src/billing/maxRetries.ts',
				files: [{ path: 'src/billing/maxRetries.ts' }],
				detail: "'MAX_RETRIES' is not camelCase",
				guidance: 'Rename to the casing its row of the table gives — types PascalCase, values camelCase.',
			},
		]);
	});

	test('reaches a declaration nested inside a function, where the same table applies', async () => {
		const input = setupOneFile({ text: 'export const getLabel = (): string => {\n\tconst max_retries = 10;\n\n\treturn `${max_retries}`;\n};\n' });

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("'max_retries' is not camelCase");
	});

	test('leaves a file whose names all sit in the casing their row gives', async () => {
		const input = setupOneFile({ text: 'export interface Invoice {\n\tlabel: string;\n}\n' });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a camelCase value constant, the casing its row of the table gives', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/billing/maxRetries.ts', 'export const maxRetries = 10;\n']] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a named constant, whose const object and derived type share one PascalCase name', async () => {
		const input = setupOneFile({
			text: ["export const Action = {\n\tAdd: 'add',\n} as const;", '', 'export type Action = (typeof Action)[keyof typeof Action];'].join('\n'),
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a PascalCase value alone, which is a component or a named constant as often as a mistake', async () => {
		const input = setupOneFile({ text: 'export const PlanCard = (): null => null;\n' });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves an anonymous default-exported class, which has no name for a row to govern', async () => {
		const input = setupOneFile({ text: 'export default class {\n\tlabel = "invoice";\n}\n' });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a destructured binding alone, whose name a payload picked rather than this repo', async () => {
		const input = setupOneFile({ text: 'export const getLabel = (payload: { user_name: string }): string => {\n\tconst { user_name } = payload;\n\n\treturn user_name;\n};\n' });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
