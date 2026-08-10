import { describe, expect, test } from '@jest/globals';
import type { StandardsCheckInput } from '@/contracts';
import { StandardsInputKind } from '@/contracts';
import { check } from './check.ts';

/**
 * The resolved import edges an import-graph rule receives, over a repo whose
 * every file is listed as a reference — `scope` narrows the run to a handful of
 * files while the boundaries stay mapped from the whole repo.
 */
const setupImportGraphInput = ({
	paths,
	edges,
	scope,
}: {
	paths: string[];
	edges: Array<{ from: string; to: string }>;
	scope?: string[];
}): StandardsCheckInput => ({
	kind: StandardsInputKind.ImportGraph,
	cwd: '/repo',
	source: scope ?? paths,
	tests: [],
	files: scope ?? paths,
	referenceFiles: paths,
	standardsPackages: [],
	edges,
});

/** The input a rule that did NOT declare `import-graph` would receive — an arm the union permits but a run never produces. */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/reporting/buildReport.ts'],
	spans: [],
});

describe('module-boundary check', () => {
	test('asks for the import graph, since the verdict is about the boundary an import crosses', () => {
		expect(check.inputKind).toBe('import-graph');
	});

	test('reports a file reaching past another module’s barrel into its internals', async () => {
		const input = setupImportGraphInput({
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
		const input = setupImportGraphInput({
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
		const input = setupImportGraphInput({
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
		const input = setupImportGraphInput({
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
		const input = setupImportGraphInput({
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
		const input = setupImportGraphInput({
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
		const input = setupImportGraphInput({
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
		const input = setupImportGraphInput({
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
		const input = setupImportGraphInput({
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

	test('still knows where the boundary sits when the run is narrowed to one file', async () => {
		const input = setupImportGraphInput({
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
		const input = setupImportGraphInput({
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

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
