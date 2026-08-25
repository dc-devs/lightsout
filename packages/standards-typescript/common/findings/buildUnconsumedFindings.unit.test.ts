import { describe, expect, test } from '@jest/globals';
import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import type { UnconsumedExport } from '../types/UnconsumedExport.ts';
import { buildUnconsumedFindings } from './buildUnconsumedFindings.ts';

/**
 * A repo as the file-text input carries it, plus the verdict one rule claims
 * over it. `files` narrows the scope when a file is present only as a reference;
 * left out, every file in `contents` is judged.
 */
const setupRepo = ({
	contents,
	files,
	rule = 'dead-export',
	matches = ({ barrel, test }: UnconsumedExport['reachedBy']) => !barrel && !test,
	detail = 'referenced nowhere else',
	guidance = 'A dead code candidate. Delete it — version control has the history.',
	standardsPacks = [],
	carveOuts = [],
}: {
	contents: Array<[string, string]>;
	files?: string[];
	rule?: string;
	matches?: (reachedBy: UnconsumedExport['reachedBy']) => boolean;
	detail?: string;
	guidance?: string;
	standardsPacks?: string[];
	carveOuts?: FrameworkCarveOut[];
}) => ({
	files: files ?? contents.map(([path]) => path),
	contents: new Map(contents),
	standardsPacks,
	carveOuts,
	rule,
	matches,
	detail,
	guidance,
});

/** The carve-outs a TanStack Start package earns — a `routes/` router root, and the entry files the plugin resolves for itself. */
const startCarveOuts: FrameworkCarveOut[] = [
	{
		directory: '.',
		entryFiles: ['router.tsx', 'server.ts', 'client.tsx'],
		exemptFolderNames: [],
		kebabCase: false,
		moduleFolders: [],
		routerRoots: ['routes'],
	},
];

describe('buildUnconsumedFindings', () => {
	test('reports the export no other file mentions, keyed by the rule and the file declaring it', () => {
		const { files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance } = setupRepo({
			contents: [
				['src/feature/index.ts', "export { renderGreeting } from './renderGreeting';"],
				['src/feature/renderGreeting.ts', 'export const renderGreeting = ({ name }: { name: string }): string => `<p>${name}</p>`;'],
				['src/feature/buildGreeting.ts', 'export const buildGreeting = ({ name }: { name: string }): string => `Hello, ${name}.`;'],
			],
		});

		const findings = buildUnconsumedFindings({ files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance });

		expect(findings).toStrictEqual([
			{
				siteKey: 'dead-export:src/feature/buildGreeting.ts',
				files: [{ path: 'src/feature/buildGreeting.ts' }],
				detail: "'buildGreeting' is referenced nowhere else",
				guidance: 'A dead code candidate. Delete it — version control has the history.',
			},
		]);
	});

	test('an export another source file imports is consumed, so the verdict passes it over', () => {
		const { files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance } = setupRepo({
			contents: [
				['src/feature/index.ts', "export { renderGreeting } from './renderGreeting';"],
				[
					'src/feature/renderGreeting.ts',
					"import { buildGreeting } from './buildGreeting';\n\nexport const renderGreeting = ({ name }: { name: string }): string => `<p>${buildGreeting({ name })}</p>`;",
				],
				['src/feature/buildGreeting.ts', 'export const buildGreeting = ({ name }: { name: string }): string => `Hello, ${name}.`;'],
			],
		});

		const findings = buildUnconsumedFindings({ files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance });

		expect(findings).toStrictEqual([]);
	});

	test('every unconsumed export of one file lands in a single finding that names each', () => {
		const { files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance } = setupRepo({
			contents: [['src/feature/tokens.ts', 'export const alphaToken = 1;\nexport const betaToken = 2;']],
		});

		const findings = buildUnconsumedFindings({ files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance });

		expect(findings).toStrictEqual([
			{
				siteKey: 'dead-export:src/feature/tokens.ts',
				files: [{ path: 'src/feature/tokens.ts' }],
				detail: "'alphaToken', 'betaToken' are referenced nowhere else",
				guidance: 'A dead code candidate. Delete it — version control has the history.',
			},
		]);
	});

	test('a verdict claiming test-reached exports reports the one only a test mentions', () => {
		const { files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance } = setupRepo({
			contents: [
				['src/feature/buildGreeting.ts', 'export const buildGreeting = ({ name }: { name: string }): string => `Hello, ${name}.`;'],
				['src/feature/buildGreeting.unit.test.ts', "import { buildGreeting } from './buildGreeting';"],
			],
			rule: 'test-only-export',
			matches: ({ barrel, test }) => test && !barrel,
			detail: 'referenced only by tests',
			guidance: 'A production-dead candidate: only its own tests keep it alive.',
		});

		const findings = buildUnconsumedFindings({ files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-only-export:src/feature/buildGreeting.ts',
				files: [{ path: 'src/feature/buildGreeting.ts' }],
				detail: "'buildGreeting' is referenced only by tests",
				guidance: 'A production-dead candidate: only its own tests keep it alive.',
			},
		]);
	});

	test('a verdict claiming barrel-reached exports reports the one only a barrel mentions', () => {
		const { files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance } = setupRepo({
			contents: [
				['src/feature/index.ts', "export { buildGreeting } from './buildGreeting';"],
				['src/feature/buildGreeting.ts', 'export const buildGreeting = ({ name }: { name: string }): string => `Hello, ${name}.`;'],
			],
			rule: 'barrel-only-export',
			matches: ({ barrel, test }) => barrel && !test,
			detail: 'exported from a barrel nothing imports',
			guidance: 'Either the module has no consumer, or the barrel entry is speculative.',
		});

		const findings = buildUnconsumedFindings({ files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance });

		expect(findings).toStrictEqual([
			{
				siteKey: 'barrel-only-export:src/feature/buildGreeting.ts',
				files: [{ path: 'src/feature/buildGreeting.ts' }],
				detail: "'buildGreeting' is exported from a barrel nothing imports",
				guidance: 'Either the module has no consumer, or the barrel entry is speculative.',
			},
		]);
	});

	test('forwards the carve-outs, so a route file consuming a barrel-published screen leaves it unreported', () => {
		const { files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance } = setupRepo({
			contents: [
				['src/routes/index.tsx', "import { RunsIndex } from '../features/app/screens/RunsIndex';\n\nexport const Route = { component: RunsIndex };"],
				['src/features/app/screens/RunsIndex/index.ts', "export { RunsIndex } from './RunsIndex';"],
				['src/features/app/screens/RunsIndex/RunsIndex.tsx', 'export const RunsIndex = (): null => null;'],
			],
			rule: 'barrel-only-export',
			matches: ({ barrel, test }) => barrel && !test,
			detail: 'exported from a barrel nothing imports',
			guidance: 'Either the module has no consumer, or the barrel entry is speculative.',
			carveOuts: startCarveOuts,
		});

		const findings = buildUnconsumedFindings({ files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance });

		// counted without the carve-outs, that route file is a barrel and the screen
		// it renders reads as published to nobody
		expect(findings).toStrictEqual([]);
	});

	test('an index file that only imports is an ordinary consumer, not a barrel', () => {
		const { files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance } = setupRepo({
			contents: [
				['src/app/index.ts', "import { startApp } from './startApp';\n\nstartApp();"],
				['src/app/startApp.ts', 'export const startApp = (): void => {};'],
			],
			rule: 'barrel-only-export',
			matches: ({ barrel }) => barrel,
			detail: 'exported from a barrel nothing imports',
			guidance: 'Either the module has no consumer, or the barrel entry is speculative.',
		});

		const findings = buildUnconsumedFindings({ files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance });

		expect(findings).toStrictEqual([]);
	});

	test('names under four characters are left unjudged, since ordinary words collide with them', () => {
		const { files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance } = setupRepo({
			contents: [
				['src/feature/sum.ts', 'export const sum = ({ a, b }: { a: number; b: number }): number => a + b;'],
				['src/feature/total.ts', 'export const total = 42;'],
			],
		});

		const findings = buildUnconsumedFindings({ files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance });

		expect(findings).toStrictEqual([
			{
				siteKey: 'dead-export:src/feature/total.ts',
				files: [{ path: 'src/feature/total.ts' }],
				detail: "'total' is referenced nowhere else",
				guidance: 'A dead code candidate. Delete it — version control has the history.',
			},
		]);
	});

	test('what a barrel or a test declares is never judged — those names belong elsewhere', () => {
		const { files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance } = setupRepo({
			contents: [
				['src/feature/index.ts', 'export const barrelHelper = 1;'],
				['src/feature/helpers.unit.test.ts', 'export const helperStub = 2;'],
			],
		});

		const findings = buildUnconsumedFindings({ files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance });

		expect(findings).toStrictEqual([]);
	});

	test('a file outside the scope still counts as a reference and is never reported itself', () => {
		const { files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance } = setupRepo({
			contents: [
				['src/feature/buildGreeting.ts', 'export const buildGreeting = ({ name }: { name: string }): string => `Hello, ${name}.`;'],
				['src/app/runApp.ts', "import { buildGreeting } from '../feature/buildGreeting';\n\nexport const runApp = () => buildGreeting({ name: 'world' });"],
			],
			files: ['src/feature/buildGreeting.ts'],
		});

		const findings = buildUnconsumedFindings({ files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance });

		expect(findings).toStrictEqual([]);
	});

	test.each([
		{ form: 'a const', line: 'export const alphaValue = 1;', name: 'alphaValue' },
		{ form: 'a class', line: 'export class AlphaService {}', name: 'AlphaService' },
		{ form: 'a function', line: 'export function alphaBuild() {}', name: 'alphaBuild' },
		{ form: 'an async function', line: 'export async function alphaFetch() {}', name: 'alphaFetch' },
		{ form: 'an interface', line: 'export interface AlphaShape {}', name: 'AlphaShape' },
		{ form: 'a type', line: 'export type AlphaKind = string;', name: 'AlphaKind' },
		{ form: 'an enum', line: 'export enum AlphaMode {}', name: 'AlphaMode' },
	])('counts $form as a declaration, so an unreferenced $name is reported', ({ line, name }) => {
		const { files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance } = setupRepo({ contents: [['src/feature/alpha.ts', line]] });

		const findings = buildUnconsumedFindings({ files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance });

		expect(findings).toStrictEqual([
			{
				siteKey: 'dead-export:src/feature/alpha.ts',
				files: [{ path: 'src/feature/alpha.ts' }],
				detail: `'${name}' is referenced nowhere else`,
				guidance: 'A dead code candidate. Delete it — version control has the history.',
			},
		]);
	});

	test('forwards the pack roots, so a rule under a declared pack’s tests/ is judged as the source it is', () => {
		const { files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance } = setupRepo({
			contents: [['standards/tests/unit-testing/10-rule/check.ts', 'export const checkRule = (): number => 1;']],
			standardsPacks: ['standards'],
		});

		const findings = buildUnconsumedFindings({ files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance });

		expect(findings).toStrictEqual([
			{
				siteKey: 'dead-export:standards/tests/unit-testing/10-rule/check.ts',
				files: [{ path: 'standards/tests/unit-testing/10-rule/check.ts' }],
				detail: "'checkRule' is referenced nowhere else",
				guidance: 'A dead code candidate. Delete it — version control has the history.',
			},
		]);
	});

	test('the same path with no pack declared above it is test code, which declares nothing judged', () => {
		const { files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance } = setupRepo({
			contents: [['standards/tests/unit-testing/10-rule/check.ts', 'export const checkRule = (): number => 1;']],
		});

		const findings = buildUnconsumedFindings({ files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance });

		expect(findings).toStrictEqual([]);
	});

	test.each([
		{ form: 'a re-export', text: "export { alphaValue } from './alphaValue';" },
		{ form: 'a default export', text: 'export default function alphaBuild() {}' },
		{ form: 'a star re-export', text: "export * from './alphaValue';" },
		{ form: 'an unexported const', text: 'const alphaValue = 1;' },
	])('reads $form as declaring nothing of its own', ({ text }) => {
		const { files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance } = setupRepo({ contents: [['src/feature/things.ts', text]] });

		const findings = buildUnconsumedFindings({ files, contents, standardsPacks, carveOuts, rule, matches, detail, guidance });

		expect(findings).toStrictEqual([]);
	});
});
