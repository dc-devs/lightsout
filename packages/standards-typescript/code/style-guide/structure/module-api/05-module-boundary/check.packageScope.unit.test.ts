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

describe('module-boundary check — package scope', () => {
	test('says nothing about an importer that belongs to no workspace package', async () => {
		const input = setupRepo({
			paths: ['scripts/buildDocs.mjs', 'apps/web/src/ingestion/index.ts', 'apps/web/src/ingestion/ingestRecords.ts', 'apps/web/src/ingestion/parseRow.ts'],
			edges: [
				{ from: 'apps/web/src/ingestion/index.ts', to: 'apps/web/src/ingestion/ingestRecords.ts' },
				{ from: 'scripts/buildDocs.mjs', to: 'apps/web/src/ingestion/ingestRecords.ts' },
			],
			dependencies: [
				['.', []],
				['apps/web', []],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('still reports an importer inside a package, so the scope narrowed rather than switched off', async () => {
		const input = setupRepo({
			paths: [
				'scripts/buildDocs.mjs',
				'apps/web/src/reporting/buildReport.ts',
				'apps/web/src/ingestion/index.ts',
				'apps/web/src/ingestion/ingestRecords.ts',
				'apps/web/src/ingestion/parseRow.ts',
			],
			edges: [
				{ from: 'apps/web/src/ingestion/index.ts', to: 'apps/web/src/ingestion/ingestRecords.ts' },
				{ from: 'scripts/buildDocs.mjs', to: 'apps/web/src/ingestion/ingestRecords.ts' },
				{ from: 'apps/web/src/reporting/buildReport.ts', to: 'apps/web/src/ingestion/ingestRecords.ts' },
			],
			dependencies: [
				['.', []],
				['apps/web', []],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:apps/web/src/ingestion/ingestRecords.ts|apps/web/src/reporting/buildReport.ts',
				files: [{ path: 'apps/web/src/reporting/buildReport.ts' }, { path: 'apps/web/src/ingestion/ingestRecords.ts' }],
				detail:
					"deep-imports 'apps/web/src/ingestion/ingestRecords.ts' — an internal of module 'apps/web/src/ingestion'; import from its barrel 'apps/web/src/ingestion/index.ts' instead",
				guidance: 'A module’s barrel is its public API; everything else is an internal.',
			},
		]);
	});

	test('judges every file when the manifests declare no workspace package at all', async () => {
		const input = setupRepo({
			paths: ['scripts/buildDocs.mjs', 'apps/web/src/ingestion/index.ts', 'apps/web/src/ingestion/ingestRecords.ts', 'apps/web/src/ingestion/parseRow.ts'],
			edges: [
				{ from: 'apps/web/src/ingestion/index.ts', to: 'apps/web/src/ingestion/ingestRecords.ts' },
				{ from: 'scripts/buildDocs.mjs', to: 'apps/web/src/ingestion/ingestRecords.ts' },
			],
			dependencies: [['.', []]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:apps/web/src/ingestion/ingestRecords.ts|scripts/buildDocs.mjs',
				files: [{ path: 'scripts/buildDocs.mjs' }, { path: 'apps/web/src/ingestion/ingestRecords.ts' }],
				detail:
					"deep-imports 'apps/web/src/ingestion/ingestRecords.ts' — an internal of module 'apps/web/src/ingestion'; import from its barrel 'apps/web/src/ingestion/index.ts' instead",
				guidance: 'A module’s barrel is its public API; everything else is an internal.',
			},
		]);
	});

	test('keeps reporting a package file that reaches into a module outside every package', async () => {
		const input = setupRepo({
			paths: ['apps/web/src/run.ts', 'scripts/reporting/index.ts', 'scripts/reporting/format.ts', 'scripts/reporting/toRow.ts'],
			edges: [
				{ from: 'scripts/reporting/index.ts', to: 'scripts/reporting/format.ts' },
				{ from: 'apps/web/src/run.ts', to: 'scripts/reporting/format.ts' },
			],
			dependencies: [
				['.', []],
				['apps/web', []],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:apps/web/src/run.ts|scripts/reporting/format.ts',
				files: [{ path: 'apps/web/src/run.ts' }, { path: 'scripts/reporting/format.ts' }],
				detail:
					"deep-imports 'scripts/reporting/format.ts' — an internal of module 'scripts/reporting'; import from its barrel 'scripts/reporting/index.ts' instead",
				guidance: 'A module’s barrel is its public API; everything else is an internal.',
			},
		]);
	});
});
