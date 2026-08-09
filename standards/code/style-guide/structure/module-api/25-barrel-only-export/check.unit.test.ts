import { expect, describe, test } from '@jest/globals';
import { StandardsInputKind } from '@/contracts';
import type { StandardsCheckInput } from '@/contracts';
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

/** The input a rule that did NOT declare `file-text` would receive — an arm the union permits but a run never produces. */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/ingestion/ingestRecords.ts'],
	spans: [],
});

describe('barrel-only-export check', () => {
	test('asks for file text, since the verdict counts mentions of a name across the repo', () => {
		expect(check.inputKind).toBe('file-text');
	});

	test('reports an export a barrel publishes and nothing else mentions', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/ingestion/index.ts', "export { ingestRecords } from './ingestRecords';"],
				['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'barrel-only-export:src/ingestion/ingestRecords.ts',
				files: [{ path: 'src/ingestion/ingestRecords.ts' }],
				detail: "'ingestRecords' is exported through a barrel but no module consumes it",
				guidance: 'Deliberate public API, or dead? Only the author knows.',
			},
		]);
	});

	test('a module importing the name through the barrel silences it', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/ingestion/index.ts', "export { ingestRecords } from './ingestRecords';"],
				['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
				['src/reporting/buildReport.ts', "import { ingestRecords } from '../ingestion';\n\nexport const buildReport = (): number => ingestRecords();"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('a name a test also reaches belongs to the test-only verdict, not this one', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/ingestion/index.ts', "export { ingestRecords } from './ingestRecords';"],
				['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
				['src/ingestion/ingestRecords.unit.test.ts', "import { ingestRecords } from './index';"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('a name no barrel publishes belongs to the dead-export verdict, not this one', async () => {
		const input = setupFileTextInput({
			contents: [['src/reporting/buildReport.ts', 'export const buildReport = (): number => 1;']],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('names every barrel-only export of one file in a single finding', async () => {
		const input = setupFileTextInput({
			contents: [
				[
					'src/ingestion/index.ts',
					["export { ingestRecords } from './ingestRecords';", "export { IngestOptions } from './ingestRecords';"].join('\n'),
				],
				['src/ingestion/ingestRecords.ts', 'export interface IngestOptions {}\nexport const ingestRecords = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'barrel-only-export:src/ingestion/ingestRecords.ts',
				files: [{ path: 'src/ingestion/ingestRecords.ts' }],
				detail: "'IngestOptions', 'ingestRecords' are exported through a barrel but no module consumes it",
				guidance: 'Deliberate public API, or dead? Only the author knows.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
