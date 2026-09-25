import { describe, expect, test } from '@jest/globals';
import { setupImportGraphInput, setupOtherKindInput } from '@lightsout/standards-testkit';
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
const crossingGuidance = 'Outside a module, import only the files its index file exports.';

describe('module-boundary check', () => {
	test('asks for the import graph, since the verdict is about where an import points', () => {
		expect(check.inputKind).toBe('import-graph');
	});

	test('reports a file importing another module’s file that its barrel does not export', async () => {
		const input = setupRepo({
			paths: ingestionPaths,
			edges: [ingestionBarrelEdge, { from: 'src/reporting/buildReport.ts', to: 'src/ingestion/parseRow.ts' }],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:src/ingestion/parseRow.ts|src/reporting/buildReport.ts',
				files: [{ path: 'src/reporting/buildReport.ts' }, { path: 'src/ingestion/parseRow.ts' }],
				detail: "imports 'src/ingestion/parseRow.ts' — an internal of module 'src/ingestion' that its barrel 'src/ingestion/index.ts' does not export",
				guidance: crossingGuidance,
			},
		]);
	});

	test('accepts a file importing another module’s file that its barrel exports — the name comes from the file that declares it', async () => {
		const input = setupRepo({
			paths: ingestionPaths,
			edges: [ingestionBarrelEdge, { from: 'src/reporting/buildReport.ts', to: 'src/ingestion/ingestRecords.ts' }],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

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

	test('a module’s own files importing each other cross no boundary', async () => {
		const input = setupRepo({
			paths: ['src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/parseRow.ts'],
			edges: [
				{ from: 'src/ingestion/index.ts', to: 'src/ingestion/ingestRecords.ts' },
				{ from: 'src/ingestion/ingestRecords.ts', to: 'src/ingestion/parseRow.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('accepts a test inside a module importing a file its barrel does not export', async () => {
		const input = setupRepo({
			paths: [...ingestionPaths, 'src/ingestion/parseRow.unit.test.ts'],
			edges: [ingestionBarrelEdge, { from: 'src/ingestion/parseRow.unit.test.ts', to: 'src/ingestion/parseRow.ts' }],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports a test outside a module importing a file its barrel does not export', async () => {
		const input = setupRepo({
			paths: [...ingestionPaths, 'tests/ingestion.test.ts'],
			edges: [ingestionBarrelEdge, { from: 'tests/ingestion.test.ts', to: 'src/ingestion/parseRow.ts' }],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:src/ingestion/parseRow.ts|tests/ingestion.test.ts',
				files: [{ path: 'tests/ingestion.test.ts' }, { path: 'src/ingestion/parseRow.ts' }],
				detail: "imports 'src/ingestion/parseRow.ts' — an internal of module 'src/ingestion' that its barrel 'src/ingestion/index.ts' does not export",
				guidance: crossingGuidance,
			},
		]);
	});

	test('gathers every unexported file one importer reaches into within a module — one edit, one finding', async () => {
		const input = setupRepo({
			paths: [...ingestionPaths, 'src/ingestion/loadSource.ts'],
			edges: [
				ingestionBarrelEdge,
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/ingestRecords.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/parseRow.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/loadSource.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/parseRow.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:src/ingestion/loadSource.ts|src/ingestion/parseRow.ts|src/reporting/buildReport.ts',
				files: [{ path: 'src/reporting/buildReport.ts' }, { path: 'src/ingestion/parseRow.ts' }, { path: 'src/ingestion/loadSource.ts' }],
				detail:
					"imports 'src/ingestion/parseRow.ts', 'src/ingestion/loadSource.ts' — internals of module 'src/ingestion' that its barrel 'src/ingestion/index.ts' does not export",
				guidance: crossingGuidance,
			},
		]);
	});

	describe('nested modules', () => {
		const nestedPaths = [
			'src/reporting/buildReport.ts',
			'src/ingestion/index.ts',
			'src/ingestion/ingestRecords.ts',
			'src/ingestion/loadSource.ts',
			'src/ingestion/parser/index.ts',
			'src/ingestion/parser/parseRow.ts',
			'src/ingestion/parser/tokenize.ts',
		];

		test('accepts a file the outer barrel exports through the lower barrel', async () => {
			const input = setupRepo({
				paths: nestedPaths,
				edges: [
					{ from: 'src/ingestion/index.ts', to: 'src/ingestion/ingestRecords.ts' },
					{ from: 'src/ingestion/index.ts', to: 'src/ingestion/parser/index.ts' },
					{ from: 'src/ingestion/parser/index.ts', to: 'src/ingestion/parser/parseRow.ts' },
					{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/parser/parseRow.ts' },
				],
			});

			const findings = await check.run({ input, settings: {} });

			expect(findings).toStrictEqual([]);
		});

		test('names the outermost module the import crosses into when the lower barrel exports the file but the outer one does not', async () => {
			const input = setupRepo({
				paths: nestedPaths,
				edges: [
					{ from: 'src/ingestion/index.ts', to: 'src/ingestion/ingestRecords.ts' },
					{ from: 'src/ingestion/parser/index.ts', to: 'src/ingestion/parser/parseRow.ts' },
					{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/parser/parseRow.ts' },
				],
			});

			const findings = await check.run({ input, settings: {} });

			expect(findings).toStrictEqual([
				{
					siteKey: 'module-boundary:src/ingestion/parser/parseRow.ts|src/reporting/buildReport.ts',
					files: [{ path: 'src/reporting/buildReport.ts' }, { path: 'src/ingestion/parser/parseRow.ts' }],
					detail: "imports 'src/ingestion/parser/parseRow.ts' — an internal of module 'src/ingestion' that its barrel 'src/ingestion/index.ts' does not export",
					guidance: crossingGuidance,
				},
			]);
		});

		test('judges a file in the outer module reaching into the lower one by the lower barrel alone', async () => {
			const input = setupRepo({
				paths: nestedPaths,
				edges: [
					{ from: 'src/ingestion/index.ts', to: 'src/ingestion/ingestRecords.ts' },
					{ from: 'src/ingestion/parser/index.ts', to: 'src/ingestion/parser/parseRow.ts' },
					{ from: 'src/ingestion/ingestRecords.ts', to: 'src/ingestion/parser/parseRow.ts' },
					{ from: 'src/ingestion/loadSource.ts', to: 'src/ingestion/parser/tokenize.ts' },
				],
			});

			const findings = await check.run({ input, settings: {} });

			expect(findings).toStrictEqual([
				{
					siteKey: 'module-boundary:src/ingestion/loadSource.ts|src/ingestion/parser/tokenize.ts',
					files: [{ path: 'src/ingestion/loadSource.ts' }, { path: 'src/ingestion/parser/tokenize.ts' }],
					detail:
						"imports 'src/ingestion/parser/tokenize.ts' — an internal of module 'src/ingestion/parser' that its barrel 'src/ingestion/parser/index.ts' does not export",
					guidance: crossingGuidance,
				},
			]);
		});
	});

	test('leaves an import into another module’s common/ to the placement rule', async () => {
		const input = setupRepo({
			paths: [...ingestionPaths, 'src/ingestion/common/utils/normalizeRecord.ts'],
			edges: [ingestionBarrelEdge, { from: 'src/reporting/buildReport.ts', to: 'src/ingestion/common/utils/normalizeRecord.ts' }],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports each of the fail fixture’s two imports: one through the barrel, one into an unexported file', async () => {
		const input = setupRepo({
			paths: [...ingestionPaths, 'src/ingestion/common/utils/normalizeRecord.ts', 'src/reporting/summarize.ts'],
			edges: [
				{ from: 'src/ingestion/ingestRecords.ts', to: 'src/ingestion/common/utils/normalizeRecord.ts' },
				ingestionBarrelEdge,
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/index.ts' },
				{ from: 'src/reporting/summarize.ts', to: 'src/ingestion/parseRow.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map((finding) => finding.siteKey)).toStrictEqual([
			'module-boundary:src/ingestion/index.ts|src/reporting/buildReport.ts',
			'module-boundary:src/ingestion/parseRow.ts|src/reporting/summarize.ts',
		]);
	});

	test('stays silent across the whole pass fixture, whose one outside importer names the exported file', async () => {
		const input = setupRepo({
			paths: [...ingestionPaths, 'src/ingestion/common/utils/normalizeRecord.ts'],
			edges: [
				{ from: 'src/ingestion/ingestRecords.ts', to: 'src/ingestion/common/utils/normalizeRecord.ts' },
				ingestionBarrelEdge,
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/ingestRecords.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('inside a declared pack, a folder under tests/ is a module whose internals can be reached past', async () => {
		const input = setupRepo({
			paths: [
				'standards/code/buildReport.ts',
				'standards/tests/unit-testing/index.ts',
				'standards/tests/unit-testing/check.ts',
				'standards/tests/unit-testing/rule.ts',
			],
			edges: [
				{ from: 'standards/tests/unit-testing/index.ts', to: 'standards/tests/unit-testing/check.ts' },
				{ from: 'standards/code/buildReport.ts', to: 'standards/tests/unit-testing/rule.ts' },
			],
			standardsPacks: ['standards'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:standards/code/buildReport.ts|standards/tests/unit-testing/rule.ts',
				files: [{ path: 'standards/code/buildReport.ts' }, { path: 'standards/tests/unit-testing/rule.ts' }],
				detail:
					"imports 'standards/tests/unit-testing/rule.ts' — an internal of module 'standards/tests/unit-testing' that its barrel 'standards/tests/unit-testing/index.ts' does not export",
				guidance: crossingGuidance,
			},
		]);
	});

	test('the same graph with no pack declared above it maps no module there, so the crossing is nobody’s boundary', async () => {
		const input = setupRepo({
			paths: [
				'standards/code/buildReport.ts',
				'standards/tests/unit-testing/index.ts',
				'standards/tests/unit-testing/check.ts',
				'standards/tests/unit-testing/rule.ts',
			],
			edges: [
				{ from: 'standards/tests/unit-testing/index.ts', to: 'standards/tests/unit-testing/check.ts' },
				{ from: 'standards/code/buildReport.ts', to: 'standards/tests/unit-testing/rule.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('still knows where the boundary sits and what the barrel exports when the run is narrowed to one file', async () => {
		const input = setupRepo({
			paths: [...ingestionPaths, 'src/reporting/summarize.ts'],
			edges: [
				ingestionBarrelEdge,
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/parseRow.ts' },
				{ from: 'src/reporting/summarize.ts', to: 'src/ingestion/ingestRecords.ts' },
			],
			scope: ['src/reporting/buildReport.ts', 'src/reporting/summarize.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:src/ingestion/parseRow.ts|src/reporting/buildReport.ts',
				files: [{ path: 'src/reporting/buildReport.ts' }, { path: 'src/ingestion/parseRow.ts' }],
				detail: "imports 'src/ingestion/parseRow.ts' — an internal of module 'src/ingestion' that its barrel 'src/ingestion/index.ts' does not export",
				guidance: crossingGuidance,
			},
		]);
	});

	test('says nothing about an importer outside the run’s scope', async () => {
		const input = setupRepo({
			paths: ingestionPaths,
			edges: [
				ingestionBarrelEdge,
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/parseRow.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/index.ts' },
			],
			scope: ['src/ingestion/ingestRecords.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('a router root is not a module, so a file importing one of its routes crosses no boundary', async () => {
		const input = setupRepo({
			paths: ['src/reporting/buildReport.ts', 'src/routes/index.tsx', 'src/routes/__root.tsx', 'src/routes/runs.$runId.tsx'],
			edges: [{ from: 'src/reporting/buildReport.ts', to: 'src/routes/runs.$runId.tsx' }],
			dependencies: [['.', ['@tanstack/react-router']]],
		});

		const findings = await check.run({ input, settings: {} });

		// the router root's index.tsx is a route the framework loads, not a barrel
		// publishing nothing — read as one it would make every route beside it an
		// internal of a module nobody wrote
		expect(findings).toStrictEqual([]);
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

	test('the same tree in a package declaring no router is an ordinary folder-module, so the import into it is reported', async () => {
		const input = setupRepo({
			paths: ['src/reporting/buildReport.ts', 'src/routes/index.tsx', 'src/routes/__root.tsx', 'src/routes/runs.$runId.tsx'],
			edges: [{ from: 'src/reporting/buildReport.ts', to: 'src/routes/runs.$runId.tsx' }],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:src/reporting/buildReport.ts|src/routes/runs.$runId.tsx',
				files: [{ path: 'src/reporting/buildReport.ts' }, { path: 'src/routes/runs.$runId.tsx' }],
				detail: "imports 'src/routes/runs.$runId.tsx' — an internal of module 'src/routes' that its barrel 'src/routes/index.tsx' does not export",
				guidance: crossingGuidance,
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
