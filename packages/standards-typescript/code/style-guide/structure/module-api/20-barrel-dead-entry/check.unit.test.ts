import { describe, expect, test } from '@jest/globals';
import type { StandardsCheckInput } from '@lightsout/standards-contracts';
import { StandardsInputKind } from '@lightsout/standards-contracts';
import { setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

/** A repo as the engine hands it to a file-text rule: every path in scope, with its text. */
const setupFileTextInput = ({ contents }: { contents: Array<[string, string]> }): StandardsCheckInput => {
	const files = contents.map(([path]) => path);

	return {
		kind: StandardsInputKind.FileText,
		cwd: '/repo',
		source: files.filter((path) => !path.includes('.test.')),
		tests: files.filter((path) => path.includes('.test.')),
		files,
		referenceFiles: [],
		contents: new Map(contents),
		standardsPackages: [],
	};
};

describe('barrel-dead-entry check', () => {
	test('asks for file text, since the verdict counts mentions of a name across the repo', () => {
		expect(check.inputKind).toBe('file-text');
	});

	test('reports a published name no file outside the module mentions', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/ingestion/index.ts', "export { ingestRecords } from './ingestRecords';"],
				['src/ingestion/ingestRecords.ts', "import { normalizeRecord } from './common/utils/normalizeRecord';"],
				['src/ingestion/common/utils/normalizeRecord.ts', 'export const normalizeRecord = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'barrel-dead-entry:src/ingestion/index.ts',
				files: [{ path: 'src/ingestion/index.ts' }],
				detail: "'ingestRecords' is exported from src/ingestion/index.ts but no file outside module 'src/ingestion' consumes it",
				guidance: 'Deliberate public API, or dead? Only the author knows.',
			},
		]);
	});

	test('names every unconsumed entry of one barrel in a single finding', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/ingestion/index.ts', ["export { ingestRecords } from './ingestRecords';", "export { parseRows } from './parseRows';"].join('\n')],
				['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
				['src/ingestion/parseRows.ts', 'export const parseRows = (): number => 1;'],
				['src/ingestion/common/utils/normalizeRecord.ts', 'export const normalizeRecord = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'barrel-dead-entry:src/ingestion/index.ts',
				files: [{ path: 'src/ingestion/index.ts' }],
				detail: "'ingestRecords', 'parseRows' are exported from src/ingestion/index.ts but no file outside module 'src/ingestion' consumes them",
				guidance: 'Deliberate public API, or dead? Only the author knows.',
			},
		]);
	});

	test('an outside consumer of the name silences it', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/ingestion/index.ts', "export { ingestRecords } from './ingestRecords';"],
				['src/ingestion/ingestRecords.ts', "import { normalizeRecord } from './common/utils/normalizeRecord';"],
				['src/ingestion/common/utils/normalizeRecord.ts', 'export const normalizeRecord = (): number => 1;'],
				['src/reporting/buildReport.ts', "import { ingestRecords } from '../ingestion';"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('a co-located test counts as a client of the public surface, wherever it sits', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/ingestion/index.ts', "export { ingestRecords } from './ingestRecords';"],
				['src/ingestion/ingestRecords.ts', "import { normalizeRecord } from './common/utils/normalizeRecord';"],
				['src/ingestion/common/utils/normalizeRecord.ts', 'export const normalizeRecord = (): number => 1;'],
				['src/ingestion/ingestRecords.unit.test.ts', "import { ingestRecords } from './index';"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('skips a name under four characters, which collides with ordinary words too often to measure', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/task/index.ts', "export { run } from './run';"],
				['src/task/run.ts', 'export const run = (): number => 1;'],
				['src/task/common/utils/tick.ts', 'export const tick = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('says nothing about a barrel that hides nothing — no boundary, so no public-surface claim to answer for', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/feature/index.ts', "export { renderGreeting } from './renderGreeting';"],
				['src/feature/renderGreeting.ts', "export const renderGreeting = (): string => 'hello';"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
