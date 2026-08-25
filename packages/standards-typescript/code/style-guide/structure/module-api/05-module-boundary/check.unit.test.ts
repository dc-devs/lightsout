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

describe('module-boundary check', () => {
	test('asks for the import graph, since the verdict is about the boundary an import crosses', () => {
		expect(check.inputKind).toBe('import-graph');
	});

	test('reports a file reaching past another module’s barrel into its internals', async () => {
		const input = setupRepo({
			paths: ['src/reporting/buildReport.ts', 'src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/common/utils/normalizeRecord.ts'],
			edges: [
				{ from: 'src/ingestion/index.ts', to: 'src/ingestion/ingestRecords.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/ingestRecords.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:src/ingestion/ingestRecords.ts|src/reporting/buildReport.ts',
				files: [{ path: 'src/reporting/buildReport.ts' }, { path: 'src/ingestion/ingestRecords.ts' }],
				detail:
					"deep-imports 'src/ingestion/ingestRecords.ts' — an internal of module 'src/ingestion'; import from its barrel 'src/ingestion/index.ts' instead",
				guidance: 'A module’s barrel is its public API; everything else is an internal.',
			},
		]);
	});

	test('importing the module’s barrel earns nothing — that is the public API the rule points at', async () => {
		const input = setupRepo({
			paths: ['src/reporting/buildReport.ts', 'src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/common/utils/normalizeRecord.ts'],
			edges: [
				{ from: 'src/ingestion/index.ts', to: 'src/ingestion/ingestRecords.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/index.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
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

	test('gathers every internal one file reaches into within a module — one edit, one finding', async () => {
		const input = setupRepo({
			paths: ['src/reporting/buildReport.ts', 'src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/parseRow.ts'],
			edges: [
				{ from: 'src/ingestion/index.ts', to: 'src/ingestion/ingestRecords.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/ingestRecords.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/parseRow.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:src/ingestion/ingestRecords.ts|src/ingestion/parseRow.ts|src/reporting/buildReport.ts',
				files: [{ path: 'src/reporting/buildReport.ts' }, { path: 'src/ingestion/ingestRecords.ts' }, { path: 'src/ingestion/parseRow.ts' }],
				detail:
					"deep-imports 'src/ingestion/ingestRecords.ts', 'src/ingestion/parseRow.ts' — internals of module 'src/ingestion'; import from its barrel 'src/ingestion/index.ts' instead",
				guidance: 'A module’s barrel is its public API; everything else is an internal.',
			},
		]);
	});

	test('names one internal once when two edges land on the same file', async () => {
		const input = setupRepo({
			paths: ['src/reporting/buildReport.ts', 'src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/parseRow.ts'],
			edges: [
				{ from: 'src/ingestion/index.ts', to: 'src/ingestion/ingestRecords.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/parseRow.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/parseRow.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:src/ingestion/parseRow.ts|src/reporting/buildReport.ts',
				files: [{ path: 'src/reporting/buildReport.ts' }, { path: 'src/ingestion/parseRow.ts' }],
				detail: "deep-imports 'src/ingestion/parseRow.ts' — an internal of module 'src/ingestion'; import from its barrel 'src/ingestion/index.ts' instead",
				guidance: 'A module’s barrel is its public API; everything else is an internal.',
			},
		]);
	});

	test('names the outermost module the import crosses into, not the nested one it lands in', async () => {
		const input = setupRepo({
			paths: [
				'src/reporting/buildReport.ts',
				'src/ingestion/index.ts',
				'src/ingestion/ingestRecords.ts',
				'src/ingestion/loadSource.ts',
				'src/ingestion/parser/index.ts',
				'src/ingestion/parser/parseRow.ts',
				'src/ingestion/parser/tokenize.ts',
			],
			edges: [
				{ from: 'src/ingestion/index.ts', to: 'src/ingestion/ingestRecords.ts' },
				{ from: 'src/ingestion/parser/index.ts', to: 'src/ingestion/parser/parseRow.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/parser/tokenize.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:src/ingestion/parser/tokenize.ts|src/reporting/buildReport.ts',
				files: [{ path: 'src/reporting/buildReport.ts' }, { path: 'src/ingestion/parser/tokenize.ts' }],
				detail:
					"deep-imports 'src/ingestion/parser/tokenize.ts' — an internal of module 'src/ingestion'; import from its barrel 'src/ingestion/index.ts' instead",
				guidance: 'A module’s barrel is its public API; everything else is an internal.',
			},
		]);
	});

	test('leaves an import into another module’s common/ to the placement rule', async () => {
		const input = setupRepo({
			paths: ['src/reporting/buildReport.ts', 'src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/common/utils/normalizeRecord.ts'],
			edges: [
				{ from: 'src/ingestion/index.ts', to: 'src/ingestion/ingestRecords.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/common/utils/normalizeRecord.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('counts a module’s import into its OWN common/ as no crossing, so the fail fixture earns exactly one finding', async () => {
		const input = setupRepo({
			paths: ['src/ingestion/common/utils/normalizeRecord.ts', 'src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/reporting/buildReport.ts'],
			edges: [
				{ from: 'src/ingestion/ingestRecords.ts', to: 'src/ingestion/common/utils/normalizeRecord.ts' },
				{ from: 'src/ingestion/index.ts', to: 'src/ingestion/ingestRecords.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/ingestRecords.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:src/ingestion/ingestRecords.ts|src/reporting/buildReport.ts',
				files: [{ path: 'src/reporting/buildReport.ts' }, { path: 'src/ingestion/ingestRecords.ts' }],
				detail:
					"deep-imports 'src/ingestion/ingestRecords.ts' — an internal of module 'src/ingestion'; import from its barrel 'src/ingestion/index.ts' instead",
				guidance: 'A module’s barrel is its public API; everything else is an internal.',
			},
		]);
	});

	test('stays silent across the whole pass fixture, whose one outside importer goes through the barrel', async () => {
		const input = setupRepo({
			paths: ['src/ingestion/common/utils/normalizeRecord.ts', 'src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/reporting/buildReport.ts'],
			edges: [
				{ from: 'src/ingestion/ingestRecords.ts', to: 'src/ingestion/common/utils/normalizeRecord.ts' },
				{ from: 'src/ingestion/index.ts', to: 'src/ingestion/ingestRecords.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/index.ts' },
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
					"deep-imports 'standards/tests/unit-testing/rule.ts' — an internal of module 'standards/tests/unit-testing'; import from its barrel 'standards/tests/unit-testing/index.ts' instead",
				guidance: 'A module’s barrel is its public API; everything else is an internal.',
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

	test('still knows where the boundary sits when the run is narrowed to one file', async () => {
		const input = setupRepo({
			paths: ['src/reporting/buildReport.ts', 'src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/parseRow.ts'],
			edges: [
				{ from: 'src/ingestion/index.ts', to: 'src/ingestion/ingestRecords.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/parseRow.ts' },
			],
			scope: ['src/reporting/buildReport.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:src/ingestion/parseRow.ts|src/reporting/buildReport.ts',
				files: [{ path: 'src/reporting/buildReport.ts' }, { path: 'src/ingestion/parseRow.ts' }],
				detail: "deep-imports 'src/ingestion/parseRow.ts' — an internal of module 'src/ingestion'; import from its barrel 'src/ingestion/index.ts' instead",
				guidance: 'A module’s barrel is its public API; everything else is an internal.',
			},
		]);
	});

	test('says nothing about an importer outside the run’s scope', async () => {
		const input = setupRepo({
			paths: ['src/reporting/buildReport.ts', 'src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/parseRow.ts'],
			edges: [
				{ from: 'src/ingestion/index.ts', to: 'src/ingestion/ingestRecords.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/parseRow.ts' },
			],
			scope: ['src/ingestion/ingestRecords.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports a deep import into a folder the package’s framework mandates as a module, whose barrel hides nothing', async () => {
		const input = setupRepo({
			paths: ['src/reporting/buildReport.ts', 'src/features/app/screens/RunsIndex/index.ts', 'src/features/app/screens/RunsIndex/RunsIndex.tsx'],
			edges: [
				{ from: 'src/features/app/screens/RunsIndex/index.ts', to: 'src/features/app/screens/RunsIndex/RunsIndex.tsx' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/features/app/screens/RunsIndex/RunsIndex.tsx' },
			],
			dependencies: [['.', ['@tanstack/react-router']]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:src/features/app/screens/RunsIndex/RunsIndex.tsx|src/reporting/buildReport.ts',
				files: [{ path: 'src/reporting/buildReport.ts' }, { path: 'src/features/app/screens/RunsIndex/RunsIndex.tsx' }],
				detail:
					"deep-imports 'src/features/app/screens/RunsIndex/RunsIndex.tsx' — an internal of module 'src/features/app/screens/RunsIndex'; import from its barrel 'src/features/app/screens/RunsIndex/index.ts' instead",
				guidance: 'A module’s barrel is its public API; everything else is an internal.',
			},
		]);
	});

	test('says nothing about the same tree in a package declaring no framework, where the omission test alone reads it as a convenience', async () => {
		const input = setupRepo({
			paths: ['src/reporting/buildReport.ts', 'src/features/app/screens/RunsIndex/index.ts', 'src/features/app/screens/RunsIndex/RunsIndex.tsx'],
			edges: [
				{ from: 'src/features/app/screens/RunsIndex/index.ts', to: 'src/features/app/screens/RunsIndex/RunsIndex.tsx' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/features/app/screens/RunsIndex/RunsIndex.tsx' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('says nothing about the same tree outside the package’s src/, where a fixture folder cannot pick up a mandate meant for source', async () => {
		const input = setupRepo({
			paths: ['src/reporting/buildReport.ts', 'fixtures/features/app/screens/RunsIndex/index.ts', 'fixtures/features/app/screens/RunsIndex/RunsIndex.tsx'],
			edges: [
				{ from: 'fixtures/features/app/screens/RunsIndex/index.ts', to: 'fixtures/features/app/screens/RunsIndex/RunsIndex.tsx' },
				{ from: 'src/reporting/buildReport.ts', to: 'fixtures/features/app/screens/RunsIndex/RunsIndex.tsx' },
			],
			dependencies: [['.', ['@tanstack/react-router']]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('takes the mandate from the package nearest the folder, so a sibling package declaring no framework keeps its identical tree unjudged', async () => {
		const input = setupRepo({
			paths: [
				'packages/web/src/reporting/buildReport.ts',
				'packages/web/src/features/app/screens/RunsIndex/index.ts',
				'packages/web/src/features/app/screens/RunsIndex/RunsIndex.tsx',
				'packages/api/src/reporting/buildReport.ts',
				'packages/api/src/features/app/screens/RunsIndex/index.ts',
				'packages/api/src/features/app/screens/RunsIndex/RunsIndex.tsx',
			],
			edges: [
				{ from: 'packages/web/src/features/app/screens/RunsIndex/index.ts', to: 'packages/web/src/features/app/screens/RunsIndex/RunsIndex.tsx' },
				{ from: 'packages/web/src/reporting/buildReport.ts', to: 'packages/web/src/features/app/screens/RunsIndex/RunsIndex.tsx' },
				{ from: 'packages/api/src/features/app/screens/RunsIndex/index.ts', to: 'packages/api/src/features/app/screens/RunsIndex/RunsIndex.tsx' },
				{ from: 'packages/api/src/reporting/buildReport.ts', to: 'packages/api/src/features/app/screens/RunsIndex/RunsIndex.tsx' },
			],
			dependencies: [
				['packages/web', ['@tanstack/react-router']],
				['packages/api', []],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:packages/web/src/features/app/screens/RunsIndex/RunsIndex.tsx|packages/web/src/reporting/buildReport.ts',
				files: [{ path: 'packages/web/src/reporting/buildReport.ts' }, { path: 'packages/web/src/features/app/screens/RunsIndex/RunsIndex.tsx' }],
				detail:
					"deep-imports 'packages/web/src/features/app/screens/RunsIndex/RunsIndex.tsx' — an internal of module 'packages/web/src/features/app/screens/RunsIndex'; import from its barrel 'packages/web/src/features/app/screens/RunsIndex/index.ts' instead",
				guidance: 'A module’s barrel is its public API; everything else is an internal.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
