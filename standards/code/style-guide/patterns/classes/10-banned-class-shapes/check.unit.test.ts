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
	source: ['src/reporting/ReportGenerator.ts'],
	spans: [],
});

describe('banned-class-shapes check', () => {
	test('asks for parsed trees, since both shapes are facts of the declaration', () => {
		expect(check.inputKind).toBe('syntax-tree');
	});

	test('reports a class that is one stateless method', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/reporting/ReportGenerator.ts',
					['export class ReportGenerator {', '\texecute({ rows }: { rows: string[] }): string {', "\t\treturn rows.join('\\n');", '\t}', '}'].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'banned-class-shape:src/reporting/ReportGenerator.ts',
				files: [{ path: 'src/reporting/ReportGenerator.ts' }],
				detail: "class 'ReportGenerator' is one stateless method",
				guidance: 'Write module functions instead — one exported function per file — and delete the class.',
			},
		]);
	});

	test('reports a class whose every member is static', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/config/ConfigPaths.ts',
					[
						'export class ConfigPaths {',
						"\tstatic readonly root = '.lightsout';",
						'',
						'\tstatic forRun({ id }: { id: string }): string {',
						'\t\treturn `.lightsout/runs/${id}`;',
						'\t}',
						'}',
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'banned-class-shape:src/config/ConfigPaths.ts',
				files: [{ path: 'src/config/ConfigPaths.ts' }],
				detail: "class 'ConfigPaths' declares only static members",
				guidance: 'Write module functions instead — one exported function per file — and delete the class.',
			},
		]);
	});

	test('calls a lone static method static-only rather than one stateless method', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/config/ConfigPaths.ts', ['export class ConfigPaths {', '\tstatic forRun({ id }: { id: string }): string {', '\t\treturn id;', '\t}', '}'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("class 'ConfigPaths' declares only static members");
	});

	test.each([
		{ member: 'static get primary(): string {\n\t\treturn "#000";\n\t}', shape: 'a static getter' },
		{ member: 'static set primary(value: string) {\n\t\tvoid value;\n\t}', shape: 'a static setter' },
	])('counts $shape among the static members that make a class static-only', async ({ member }) => {
		const input = setupSyntaxTreeInput({ sources: [['src/theme/Palette.ts', ['export class Palette {', `\t${member}`, '}'].join('\n')]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("class 'Palette' declares only static members");
	});

	test('names a default-exported class without a name as anonymous', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/reporting/index.ts', ['export default class {', '\texecute(): string {', "\t\treturn '';", '\t}', '}'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("class '(anonymous)' is one stateless method");
	});

	test.each([
		{ member: 'private count = 0;\n\n\tincrement(): number {\n\t\treturn (this.count += 1);\n\t}', state: 'a property' },
		{ member: 'constructor(private readonly host: string) {}\n\n\tsend(): string {\n\t\treturn this.host;\n\t}', state: 'a constructor' },
		{ member: 'get total(): number {\n\t\treturn 0;\n\t}\n\n\tcheckout(): string {\n\t\treturn "ok";\n\t}', state: 'a getter' },
		{ member: 'set total(value: number) {\n\t\tvoid value;\n\t}\n\n\tcheckout(): string {\n\t\treturn "ok";\n\t}', state: 'a setter' },
	])('leaves a one-method class that binds state through $state', async ({ member }) => {
		const input = setupSyntaxTreeInput({ sources: [['src/cart/Cart.ts', ['export class Cart {', `\t${member}`, '}'].join('\n')]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves static members alone once a constructor makes the class instantiable', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/registry/Registry.ts', ['export class Registry {', '\tstatic items: string[] = [];', '', '\tconstructor() {}', '}'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test.each([
		{ heritage: 'extends BaseGenerator', relation: 'extends a base class' },
		{ heritage: 'implements Generator', relation: 'implements an interface' },
	])('leaves a one-method class that $relation', async ({ heritage }) => {
		const input = setupSyntaxTreeInput({
			sources: [['src/reporting/JsonReportGenerator.ts', [`export class JsonReportGenerator ${heritage} {`, '\texecute(): string {', "\t\treturn '{}';", '\t}', '}'].join('\n')]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test.each([
		{ source: ['@Injectable()', 'export class MailerService {', '\tsend(): string {', "\t\treturn 'sent';", '\t}', '}'], owner: 'a decorator' },
		{ source: ['export abstract class Repository {', '\tabstract find(): string;', '}'], owner: 'the abstract keyword' },
	])('leaves a class $owner marks as framework-owned', async ({ source }) => {
		const input = setupSyntaxTreeInput({ sources: [['src/mail/MailerService.ts', source.join('\n')]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a class with no members at all', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/errors/ParseError.ts', 'export class ParseError {}\n']] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('finds a banned class nested inside a function body', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/reporting/makeGenerator.ts',
					['export const makeGenerator = () => {', '\tclass ReportGenerator {', '\t\texecute(): string {', "\t\t\treturn '';", '\t\t}', '\t}', '', '\treturn ReportGenerator;', '};'].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("class 'ReportGenerator' is one stateless method");
	});

	test('gathers every banned class of one file into one job', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/reporting/shapes.ts',
					[
						'export class ConfigPaths {',
						"\tstatic readonly root = '.lightsout';",
						'}',
						'',
						'export class ReportGenerator {',
						'\texecute(): string {',
						"\t\treturn '';",
						'\t}',
						'}',
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'banned-class-shape:src/reporting/shapes.ts',
				files: [{ path: 'src/reporting/shapes.ts' }],
				detail: "class 'ConfigPaths' declares only static members; class 'ReportGenerator' is one stateless method",
				guidance: 'Write module functions instead — one exported function per file — and delete the class.',
			},
		]);
	});

	test('reports each offending file on its own and passes over the files that are clean', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/reporting/formatReportRows.ts', "export const formatReportRows = ({ rows }: { rows: string[] }): string => rows.join('\\n');\n"],
				['src/reporting/ReportGenerator.ts', ['export class ReportGenerator {', '\texecute(): string {', "\t\treturn '';", '\t}', '}'].join('\n')],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'banned-class-shape:src/reporting/ReportGenerator.ts',
				files: [{ path: 'src/reporting/ReportGenerator.ts' }],
				detail: "class 'ReportGenerator' is one stateless method",
				guidance: 'Write module functions instead — one exported function per file — and delete the class.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
