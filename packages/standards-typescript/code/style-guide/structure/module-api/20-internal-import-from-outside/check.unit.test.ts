import { describe, expect, test } from '@jest/globals';
import { setupImportGraphInput, setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

/** The resolved import edges an import-graph rule receives; `scope` narrows the run to a handful of files. */
const setupRepo = ({ paths, edges, scope }: { paths: string[]; edges: Array<{ from: string; to: string }>; scope?: string[] }) =>
	setupImportGraphInput({ edges, source: scope ?? paths, files: scope ?? paths, referenceFiles: paths });

const guidance = 'A file under internal/ is private to the folder holding it — move it out of internal/ to share it, or keep the import inside that folder.';

describe('internal-import-from-outside check', () => {
	test('reports a file outside a folder importing that folder’s internal file', async () => {
		const input = setupRepo({
			paths: ['src/reporting/buildReport.ts', 'src/ingestion/internal/parseRow.ts'],
			edges: [{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/internal/parseRow.ts' }],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'internal-import-from-outside:src/ingestion/internal/parseRow.ts|src/reporting/buildReport.ts',
				files: [{ path: 'src/reporting/buildReport.ts' }, { path: 'src/ingestion/internal/parseRow.ts' }],
				detail: "imports 'src/ingestion/internal/parseRow.ts' — internal to 'src/ingestion', which 'src/reporting/buildReport.ts' is outside of",
				guidance,
			},
		]);
	});

	test('accepts every file inside the folder, its tests and nested folders included', async () => {
		const input = setupRepo({
			paths: [
				'src/ingestion/ingestRecords.ts',
				'src/ingestion/ingestRecords.unit.test.ts',
				'src/ingestion/parser/tokenize.ts',
				'src/ingestion/internal/parseRow.ts',
				'src/ingestion/internal/readHeader.ts',
			],
			edges: [
				{ from: 'src/ingestion/ingestRecords.ts', to: 'src/ingestion/internal/parseRow.ts' },
				{ from: 'src/ingestion/ingestRecords.unit.test.ts', to: 'src/ingestion/internal/parseRow.ts' },
				{ from: 'src/ingestion/parser/tokenize.ts', to: 'src/ingestion/internal/parseRow.ts' },
				{ from: 'src/ingestion/internal/parseRow.ts', to: 'src/ingestion/internal/readHeader.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('holds a nested internal file to its own folder, even for a file inside the outer one', async () => {
		const input = setupRepo({
			paths: ['src/ingestion/ingestRecords.ts', 'src/ingestion/parser/internal/tokenize.ts'],
			edges: [{ from: 'src/ingestion/ingestRecords.ts', to: 'src/ingestion/parser/internal/tokenize.ts' }],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ detail }) => detail)).toStrictEqual([
			"imports 'src/ingestion/parser/internal/tokenize.ts' — internal to 'src/ingestion/parser', which 'src/ingestion/ingestRecords.ts' is outside of",
		]);
	});

	test('names every internal file one importer reaches in one folder in a single finding — one decision, one finding', async () => {
		const input = setupRepo({
			paths: ['src/reporting/buildReport.ts', 'src/ingestion/internal/parseRow.ts', 'src/ingestion/internal/readHeader.ts'],
			edges: [
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/internal/parseRow.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/internal/readHeader.ts' },
				{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/internal/readHeader.ts' },
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ files }) => files)).toStrictEqual([
			[{ path: 'src/reporting/buildReport.ts' }, { path: 'src/ingestion/internal/parseRow.ts' }, { path: 'src/ingestion/internal/readHeader.ts' }],
		]);
	});

	test('reports an internal folder at the repo root to nobody, since every file is inside the root', async () => {
		const input = setupRepo({
			paths: ['scripts/build.mjs', 'internal/secrets.ts'],
			edges: [{ from: 'scripts/build.mjs', to: 'internal/secrets.ts' }],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('does not read a file named internal as a folder', async () => {
		const input = setupRepo({
			paths: ['src/reporting/buildReport.ts', 'src/ingestion/internal.ts'],
			edges: [{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/internal.ts' }],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('judges only the files in scope', async () => {
		const input = setupRepo({
			paths: ['src/reporting/buildReport.ts', 'src/ingestion/internal/parseRow.ts'],
			edges: [{ from: 'src/reporting/buildReport.ts', to: 'src/ingestion/internal/parseRow.ts' }],
			scope: ['src/ingestion/internal/parseRow.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('answers nothing for an input of another kind', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
