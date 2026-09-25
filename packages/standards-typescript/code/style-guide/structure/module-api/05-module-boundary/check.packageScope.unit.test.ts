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
				{ from: 'scripts/buildDocs.mjs', to: 'apps/web/src/ingestion/parseRow.ts' },
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
				{ from: 'scripts/buildDocs.mjs', to: 'apps/web/src/ingestion/parseRow.ts' },
				{ from: 'apps/web/src/reporting/buildReport.ts', to: 'apps/web/src/ingestion/parseRow.ts' },
			],
			dependencies: [
				['.', []],
				['apps/web', []],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:apps/web/src/ingestion/parseRow.ts|apps/web/src/reporting/buildReport.ts',
				files: [{ path: 'apps/web/src/reporting/buildReport.ts' }, { path: 'apps/web/src/ingestion/parseRow.ts' }],
				detail:
					"imports 'apps/web/src/ingestion/parseRow.ts' — an internal of module 'apps/web/src/ingestion' that its barrel 'apps/web/src/ingestion/index.ts' does not export",
				guidance: 'Outside a module, import only the files its index file exports.',
			},
		]);
	});

	test('judges every file when the manifests declare no workspace package at all', async () => {
		const input = setupRepo({
			paths: ['scripts/buildDocs.mjs', 'apps/web/src/ingestion/index.ts', 'apps/web/src/ingestion/ingestRecords.ts', 'apps/web/src/ingestion/parseRow.ts'],
			edges: [
				{ from: 'apps/web/src/ingestion/index.ts', to: 'apps/web/src/ingestion/ingestRecords.ts' },
				{ from: 'scripts/buildDocs.mjs', to: 'apps/web/src/ingestion/parseRow.ts' },
			],
			dependencies: [['.', []]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:apps/web/src/ingestion/parseRow.ts|scripts/buildDocs.mjs',
				files: [{ path: 'scripts/buildDocs.mjs' }, { path: 'apps/web/src/ingestion/parseRow.ts' }],
				detail:
					"imports 'apps/web/src/ingestion/parseRow.ts' — an internal of module 'apps/web/src/ingestion' that its barrel 'apps/web/src/ingestion/index.ts' does not export",
				guidance: 'Outside a module, import only the files its index file exports.',
			},
		]);
	});

	test('keeps reporting a package file that reaches into a module outside every package', async () => {
		const input = setupRepo({
			paths: ['apps/web/src/run.ts', 'scripts/reporting/index.ts', 'scripts/reporting/format.ts', 'scripts/reporting/toRow.ts'],
			edges: [
				{ from: 'scripts/reporting/index.ts', to: 'scripts/reporting/format.ts' },
				{ from: 'apps/web/src/run.ts', to: 'scripts/reporting/toRow.ts' },
			],
			dependencies: [
				['.', []],
				['apps/web', []],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:apps/web/src/run.ts|scripts/reporting/toRow.ts',
				files: [{ path: 'apps/web/src/run.ts' }, { path: 'scripts/reporting/toRow.ts' }],
				detail: "imports 'scripts/reporting/toRow.ts' — an internal of module 'scripts/reporting' that its barrel 'scripts/reporting/index.ts' does not export",
				guidance: 'Outside a module, import only the files its index file exports.',
			},
		]);
	});

	test('reports an import through an index file of the importer’s own package, and leaves another package’s entry alone', async () => {
		const input = setupRepo({
			paths: [
				'packages/web/src/app.ts',
				'packages/web/src/index.ts',
				'packages/web/src/routes/runs.ts',
				'packages/engine/src/index.ts',
				'packages/engine/src/contracts/index.ts',
				'packages/engine/src/contracts/RunStatus.ts',
			],
			edges: [
				{ from: 'packages/engine/src/contracts/index.ts', to: 'packages/engine/src/contracts/RunStatus.ts' },
				{ from: 'packages/web/src/app.ts', to: 'packages/web/src/index.ts' },
				{ from: 'packages/web/src/app.ts', to: 'packages/engine/src/contracts/index.ts' },
				{ from: 'packages/web/src/routes/runs.ts', to: 'packages/engine/src/index.ts' },
			],
			dependencies: [
				['.', []],
				['packages/engine', []],
				['packages/web', []],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'module-boundary:packages/web/src/app.ts|packages/web/src/index.ts',
				files: [{ path: 'packages/web/src/app.ts' }, { path: 'packages/web/src/index.ts' }],
				detail: "imports through 'packages/web/src/index.ts' — import each name from the file that declares it instead",
				guidance: 'An index file lists what its module makes public; nothing imports through it.',
			},
		]);
	});
});
