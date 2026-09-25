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

const crossingGuidance = 'Outside a module, import only the files its index file exports.';

describe('module-boundary check — nested modules', () => {
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
