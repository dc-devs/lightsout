import { describe, expect, test } from '@jest/globals';
import { setupImportGraphInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

/**
 * The resolved import edges an import-graph rule receives, over a repo whose
 * every file is listed as a reference — `scope` narrows the run to a handful of
 * files while the boundaries stay mapped from the whole repo.
 */
const setupRepo = ({
	paths,
	edges,
	scope,
	standardsPacks = [],
	dependencies = [],
}: {
	paths: string[];
	edges: Array<{ from: string; to: string }>;
	scope?: string[];
	standardsPacks?: string[];
	dependencies?: Array<[string, string[]]>;
}) => {
	return setupImportGraphInput({ edges, dependencies, source: scope ?? paths, files: scope ?? paths, referenceFiles: paths, standardsPacks });
};

/** The ingestion module every case below builds on: its barrel exports `ingestRecords.ts` and hides `parseRow.ts`. */
const ingestionPaths = ['src/reporting/buildReport.ts', 'src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/parseRow.ts'];
const ingestionBarrelEdge = { from: 'src/ingestion/index.ts', to: 'src/ingestion/ingestRecords.ts' };

const throughIndexGuidance = 'An index file lists what its module makes public; nothing imports through it.';

describe('module-boundary check — imports through an index file', () => {
	test('reports a file importing through another module’s barrel', async () => {
		const input = setupRepo({
			paths: ingestionPaths,
			edges: [ingestionBarrelEdge, { from: 'src/reporting/buildReport.ts', to: 'src/ingestion/index.ts' }],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:src/ingestion/index.ts|src/reporting/buildReport.ts',
				files: [{ path: 'src/reporting/buildReport.ts' }, { path: 'src/ingestion/index.ts' }],
				detail: "imports through 'src/ingestion/index.ts' — import each name from the file that declares it instead",
				guidance: throughIndexGuidance,
			},
		]);
	});

	test('reports a module’s own file importing through its own barrel', async () => {
		const input = setupRepo({
			paths: ingestionPaths,
			edges: [ingestionBarrelEdge, { from: 'src/ingestion/parseRow.ts', to: 'src/ingestion/index.ts' }],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:src/ingestion/index.ts|src/ingestion/parseRow.ts',
				files: [{ path: 'src/ingestion/parseRow.ts' }, { path: 'src/ingestion/index.ts' }],
				detail: "imports through 'src/ingestion/index.ts' — import each name from the file that declares it instead",
				guidance: throughIndexGuidance,
			},
		]);
	});

	test('reports an import through a folder index file that marks no module, since no import goes through any index file', async () => {
		const input = setupRepo({
			paths: ['src/reporting/buildReport.ts', 'src/helpers/index.ts', 'src/helpers/formatDate.ts'],
			edges: [
				{ from: 'src/helpers/index.ts', to: 'src/helpers/formatDate.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/helpers/index.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:src/helpers/index.ts|src/reporting/buildReport.ts',
				files: [{ path: 'src/reporting/buildReport.ts' }, { path: 'src/helpers/index.ts' }],
				detail: "imports through 'src/helpers/index.ts' — import each name from the file that declares it instead",
				guidance: throughIndexGuidance,
			},
		]);
	});

	test('names every index file one file imports through in a single finding — one edit, one finding', async () => {
		const input = setupRepo({
			paths: [...ingestionPaths, 'src/helpers/index.ts', 'src/helpers/formatDate.ts'],
			edges: [
				ingestionBarrelEdge,
				{ from: 'src/helpers/index.ts', to: 'src/helpers/formatDate.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/index.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/helpers/index.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/helpers/index.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:src/helpers/index.ts|src/ingestion/index.ts|src/reporting/buildReport.ts',
				files: [{ path: 'src/reporting/buildReport.ts' }, { path: 'src/ingestion/index.ts' }, { path: 'src/helpers/index.ts' }],
				detail: "imports through 'src/ingestion/index.ts', 'src/helpers/index.ts' — import each name from the file that declares it instead",
				guidance: throughIndexGuidance,
			},
		]);
	});

	test('accepts a barrel re-exporting from a lower barrel', async () => {
		const input = setupRepo({
			paths: [
				'src/ingestion/index.ts',
				'src/ingestion/ingestRecords.ts',
				'src/ingestion/parser/index.ts',
				'src/ingestion/parser/parseRow.ts',
				'src/ingestion/parser/tokenize.ts',
			],
			edges: [
				{ from: 'src/ingestion/index.ts', to: 'src/ingestion/ingestRecords.ts' },
				{ from: 'src/ingestion/index.ts', to: 'src/ingestion/parser/index.ts' },
				{ from: 'src/ingestion/parser/index.ts', to: 'src/ingestion/parser/parseRow.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('accepts a barrel’s own test importing the barrel it tests', async () => {
		const input = setupRepo({
			paths: [...ingestionPaths, 'src/ingestion/index.unit.test.ts'],
			edges: [ingestionBarrelEdge, { from: 'src/ingestion/index.unit.test.ts', to: 'src/ingestion/index.ts' }],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports a test beside another file importing its module’s barrel', async () => {
		const input = setupRepo({
			paths: [...ingestionPaths, 'src/ingestion/ingestRecords.unit.test.ts'],
			edges: [ingestionBarrelEdge, { from: 'src/ingestion/ingestRecords.unit.test.ts', to: 'src/ingestion/index.ts' }],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:src/ingestion/index.ts|src/ingestion/ingestRecords.unit.test.ts',
				files: [{ path: 'src/ingestion/ingestRecords.unit.test.ts' }, { path: 'src/ingestion/index.ts' }],
				detail: "imports through 'src/ingestion/index.ts' — import each name from the file that declares it instead",
				guidance: throughIndexGuidance,
			},
		]);
	});

	test('a route index file the framework loads is no barrel, so importing it is not an import through one', async () => {
		const input = setupRepo({
			paths: ['src/router.tsx', 'src/routes/index.tsx', 'src/routes/__root.tsx'],
			edges: [{ from: 'src/router.tsx', to: 'src/routes/index.tsx' }],
			dependencies: [['.', ['@tanstack/react-router']]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
