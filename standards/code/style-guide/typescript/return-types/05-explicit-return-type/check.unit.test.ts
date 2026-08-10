import { describe, expect, test } from '@jest/globals';
import type ts from 'typescript';
import { resolveConsumerTypescript } from '@/common/utils/resolveConsumerTypescript';
import type { StandardsCheckInput } from '@/contracts';
import { StandardsInputKind } from '@/contracts';
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

	return {
		kind: StandardsInputKind.SyntaxTree,
		cwd: '/repo',
		source: paths,
		tests: [],
		files: paths,
		referenceFiles: [],
		standardsPackages: [],
		compiler,
		trees,
	};
};

/** The input a rule that did NOT declare `syntax-tree` would receive — an arm the union permits but a run never produces. */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/users/getUserDisplayName.ts'],
	spans: [],
});

describe('explicit-return-type check', () => {
	test('asks for parsed trees, since the missing annotation is a fact of the declaration', () => {
		expect(check.inputKind).toBe('syntax-tree');
	});

	test('reports an exported arrow that declares no return type', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/users/getUserDisplayName.ts', "export const getUserDisplayName = ({ user }: Params) => user?.name ?? 'Unknown';\n"]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'explicit-return-type:src/users/getUserDisplayName.ts',
				files: [{ path: 'src/users/getUserDisplayName.ts' }],
				detail: "exported 'getUserDisplayName' declares no return type",
				guidance: 'Declare the return type — it is the output half of the contract, and it fails at the definition site rather than in a consumer.',
			},
		]);
	});

	test('reports an exported `function` declaration that declares no return type', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/users/getUserDisplayName.ts', ['export function getUserDisplayName({ user }: Params) {', "\treturn user?.name ?? 'Unknown';", '}'].join('\n')],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'explicit-return-type:src/users/getUserDisplayName.ts',
				files: [{ path: 'src/users/getUserDisplayName.ts' }],
				detail: "exported 'getUserDisplayName' declares no return type",
				guidance: 'Declare the return type — it is the output half of the contract, and it fails at the definition site rather than in a consumer.',
			},
		]);
	});

	test('reports an exported `function` expression assigned to a name, the same as an arrow', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/users/getUserDisplayName.ts',
					['export const getUserDisplayName = function ({ user }: Params) {', "\treturn user?.name ?? 'Unknown';", '};'].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("exported 'getUserDisplayName' declares no return type");
	});

	test.each([
		{ shape: 'an arrow', text: 'export const getUserDisplayName = ({ user }: Params): string => user.name;' },
		{ shape: 'a `function` declaration', text: 'export function getUserDisplayName({ user }: Params): string {\n\treturn user.name;\n}' },
	])('leaves $shape that states its return type', async ({ text }) => {
		const input = setupSyntaxTreeInput({ sources: [['src/users/getUserDisplayName.ts', `${text}\n`]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test.each([
		{ shape: 'an arrow', text: 'export const pickFirstMatch = <Item>({ items }: { items: Item[] }) => items[0];' },
		{ shape: 'a `function` declaration', text: 'export function pickFirstMatch<Item>({ items }: { items: Item[] }) {\n\treturn items[0];\n}' },
	])('leaves $shape whose type parameters are the contract', async ({ text }) => {
		const input = setupSyntaxTreeInput({ sources: [['src/issues/pickFirstMatch.ts', `${text}\n`]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves an arrow whose variable is annotated, since the contract is already declared one line above', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/users/getUserDisplayName.ts', 'export const getUserDisplayName: DisplayNameReader = ({ user }) => user.name;\n']],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves every export of a `.tsx` file, where framework components live', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/ui/Badge.tsx', 'export const Badge = ({ label }: { label: string }) => label;\n']] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test.each([
		{
			shape: 'an arrow',
			text: "const normalizeName = ({ name }: { name: string }) => name.trim();\n\nexport const getName = (): string => normalizeName({ name: 'a' });",
		},
		{
			shape: 'a `function` declaration',
			text: 'function normalizeName({ name }: { name: string }) {\n\treturn name.trim();\n}\n\nexport const used = normalizeName;',
		},
	])('leaves $shape the file keeps to itself, since inference is precise for an internal', async ({ text }) => {
		const input = setupSyntaxTreeInput({ sources: [['src/users/getName.ts', `${text}\n`]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a function nested inside an exported one, since only the file is public', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/users/getUserDisplayName.ts',
					[
						'export const getUserDisplayName = ({ user }: Params): string => {',
						'\tconst normalize = (name: string) => name.trim();',
						'',
						'\treturn normalize(user.name);',
						'};',
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test.each([
		{ shape: 'a plain value', text: 'export const RETRY_LIMIT = 3;' },
		{ shape: 'a binding with nothing assigned to it', text: 'export let currentHandler;' },
		{ shape: 'a class rather than a function', text: 'export class ParseError {}' },
	])('leaves an export that is $shape', async ({ text }) => {
		const input = setupSyntaxTreeInput({ sources: [['src/users/settings.ts', `${text}\n`]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves an exported function with no name to report', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/users/index.ts', ['export default function ({ user }: Params) {', '\treturn user.name;', '}'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves an exported function destructured into a pattern rather than bound to one name', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/users/handlers.ts', 'export const { getUserDisplayName } = () => 1;\n']] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a statement that cannot carry an export keyword at all', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/users/register.ts', "console.log('registered');\n"]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('gathers every unannotated export of one file into one job, since one pass annotates them together', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/users/readers.ts',
					[
						'export const getFirstName = ({ user }: Params) => user.first;',
						'',
						'export function getLastName({ user }: Params) {',
						'\treturn user.last;',
						'}',
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'explicit-return-type:src/users/readers.ts',
				files: [{ path: 'src/users/readers.ts' }],
				detail: "exported 'getFirstName' declares no return type; exported 'getLastName' declares no return type",
				guidance: 'Declare the return type — it is the output half of the contract, and it fails at the definition site rather than in a consumer.',
			},
		]);
	});

	test('reads every name of one `export const` statement that declares several', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/users/readers.ts', 'export const getFirstName = ({ user }: Params) => user.first,\n\tgetLastName = ({ user }: Params) => user.last;\n']],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("exported 'getFirstName' declares no return type; exported 'getLastName' declares no return type");
	});

	test('reports each offending file on its own and passes over the files that are clean', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/users/getFirstName.ts', 'export const getFirstName = ({ user }: Params): string => user.first;\n'],
				['src/users/getLastName.ts', 'export const getLastName = ({ user }: Params) => user.last;\n'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'explicit-return-type:src/users/getLastName.ts',
				files: [{ path: 'src/users/getLastName.ts' }],
				detail: "exported 'getLastName' declares no return type",
				guidance: 'Declare the return type — it is the output half of the contract, and it fails at the definition site rather than in a consumer.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
