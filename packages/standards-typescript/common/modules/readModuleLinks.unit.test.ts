import { describe, expect, test } from '@jest/globals';
import type { TypeCheckerInput } from '@lightsout/standards-contracts';
import { setupTypeCheckerInput } from '@lightsout/standards-testkit';
import ts from 'typescript';
import { readModuleLinks } from './readModuleLinks.ts';

/** The links one arranged file makes, read through a real program over all of them. */
const linksOf = ({ sources, path }: { sources: Array<[string, string]>; path: string }) => {
	const input = setupTypeCheckerInput({ sources }) as TypeCheckerInput;
	const typed = input.typedFiles.get(path);

	if (typed === undefined) {
		throw new Error(`${path} was not typed`);
	}

	return readModuleLinks({ sourceFile: typed.sourceFile, checker: typed.checker, compiler: ts, cwd: input.cwd });
};

describe('readModuleLinks', () => {
	test('resolves a named import to the repo-relative file it names, source name and local name apart', () => {
		const links = linksOf({
			sources: [
				[
					'src/reporting/buildReport.ts',
					"import { ingestRecords as ingest } from '../ingestion/ingestRecords.ts';\n\nexport const buildReport = (): number => ingest();",
				],
				['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
			],
			path: 'src/reporting/buildReport.ts',
		});

		expect(links).toStrictEqual([
			{
				typeOnly: false,
				reExport: false,
				star: false,
				resolved: true,
				target: 'src/ingestion/ingestRecords.ts',
				names: [{ from: 'ingestRecords', as: 'ingest' }],
			},
		]);
	});

	test('marks a re-export as one, so a barrel’s surface and a file’s consumption can be told apart', () => {
		const links = linksOf({
			sources: [
				['src/ingestion/index.ts', "export { ingestRecords } from './ingestRecords.ts';"],
				['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
			],
			path: 'src/ingestion/index.ts',
		});

		expect(links[0]?.reExport).toBe(true);
		expect(links[0]?.target).toBe('src/ingestion/ingestRecords.ts');
	});

	test('reads `export *` as taking the whole surface with no names written down', () => {
		const links = linksOf({
			sources: [
				['src/ingestion/index.ts', "export * from './ingestRecords.ts';"],
				['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
			],
			path: 'src/ingestion/index.ts',
		});

		expect(links[0]).toStrictEqual({ typeOnly: false, reExport: true, star: true, resolved: true, target: 'src/ingestion/ingestRecords.ts', names: [] });
	});

	test('reads a namespace import the same way — the whole surface, nothing named', () => {
		const links = linksOf({
			sources: [
				[
					'src/reporting/buildReport.ts',
					"import * as ingestion from '../ingestion/ingestRecords.ts';\n\nexport const buildReport = (): number => ingestion.ingestRecords();",
				],
				['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
			],
			path: 'src/reporting/buildReport.ts',
		});

		expect(links[0]?.star).toBe(true);
		expect(links[0]?.names).toStrictEqual([]);
	});

	test('reports a default import under the name `default`, beside any named ones', () => {
		const links = linksOf({
			sources: [
				[
					'src/reporting/buildReport.ts',
					"import build, { helper } from '../ingestion/ingestRecords.ts';\n\nexport const buildReport = (): number => build() + helper();",
				],
				['src/ingestion/ingestRecords.ts', 'export const helper = (): number => 1;\n\nexport default (): number => 1;'],
			],
			path: 'src/reporting/buildReport.ts',
		});

		expect(links[0]?.names).toStrictEqual([
			{ from: 'default', as: 'build' },
			{ from: 'helper', as: 'helper' },
		]);
	});

	test('a specifier the compiler cannot place is unresolved, not absent — a rule arguing from absence has to stand down', () => {
		const links = linksOf({
			sources: [['src/reporting/buildReport.ts', "import { missing } from './nowhere.ts';\n\nexport const buildReport = (): number => missing();"]],
			path: 'src/reporting/buildReport.ts',
		});

		expect(links[0]?.resolved).toBe(false);
		expect(links[0]?.target).toBeUndefined();
		expect(links[0]?.names).toStrictEqual([{ from: 'missing', as: 'missing' }]);
	});

	test('a plain `export` with nothing after `from` is not a module link at all', () => {
		const links = linksOf({
			sources: [['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;\n\nexport type Rows = number;']],
			path: 'src/ingestion/ingestRecords.ts',
		});

		expect(links).toStrictEqual([]);
	});

	test('marks a whole-statement `import type` as type-only, which the barrel rules read as a contract rather than a use', () => {
		const links = linksOf({
			sources: [
				[
					'src/reporting/buildReport.ts',
					"import type { Rows } from '../ingestion/ingestRecords.ts';\n\nexport const buildReport = (rows: Rows): number => rows;",
				],
				['src/ingestion/ingestRecords.ts', 'export type Rows = number;'],
			],
			path: 'src/reporting/buildReport.ts',
		});

		expect(links[0]?.typeOnly).toBe(true);
	});
});
