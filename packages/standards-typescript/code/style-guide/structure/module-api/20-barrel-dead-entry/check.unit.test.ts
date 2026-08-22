import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupTypeCheckerInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

/** A repo as the engine hands it to a type-checker rule, with the test files told apart by name. */
const setupRepo = ({ sources, standardsPacks = [] }: { sources: Array<[string, string]>; standardsPacks?: string[] }) => {
	const paths = sources.map(([path]) => path);

	return setupTypeCheckerInput({
		sources,
		source: paths.filter((path) => !path.includes('.test.')),
		tests: paths.filter((path) => path.includes('.test.')),
		files: paths,
		standardsPacks,
	});
};

describe('barrel-dead-entry check', () => {
	test('asks for a type checker, since the verdict turns on which module a name was imported FROM', () => {
		expect(check.inputKind).toBe('type-checker');
	});

	test('reports a published name nothing outside the module imports from the barrel', async () => {
		const input = setupRepo({
			sources: [
				['src/ingestion/index.ts', "export { ingestRecords } from './ingestRecords.ts';"],
				[
					'src/ingestion/ingestRecords.ts',
					"import { normalizeRecord } from './common/utils/normalizeRecord.ts';\n\nexport const ingestRecords = (): number => normalizeRecord();",
				],
				['src/ingestion/common/utils/normalizeRecord.ts', 'export const normalizeRecord = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'barrel-dead-entry:src/ingestion/index.ts',
				files: [{ path: 'src/ingestion/index.ts' }],
				detail: "'ingestRecords' is exported from src/ingestion/index.ts but nothing outside module 'src/ingestion' imports it from there",
				guidance: 'Deliberate public API, or dead? Only the author knows.',
			},
		]);
	});

	test('names every unconsumed entry of one barrel in a single finding', async () => {
		const input = setupRepo({
			sources: [
				['src/ingestion/index.ts', ["export { ingestRecords } from './ingestRecords.ts';", "export { parseRows } from './parseRows.ts';"].join('\n')],
				['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
				['src/ingestion/parseRows.ts', 'export const parseRows = (): number => 1;'],
				['src/ingestion/common/utils/normalizeRecord.ts', 'export const normalizeRecord = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe(
			"'ingestRecords', 'parseRows' are exported from src/ingestion/index.ts but nothing outside module 'src/ingestion' imports them from there",
		);
	});

	test('an outside module importing the name through the barrel silences it', async () => {
		const input = setupRepo({
			sources: [
				['src/ingestion/index.ts', "export { ingestRecords } from './ingestRecords.ts';"],
				['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
				['src/ingestion/common/utils/normalizeRecord.ts', 'export const normalizeRecord = (): number => 1;'],
				['src/reporting/buildReport.ts', "import { ingestRecords } from '../ingestion/index.ts';\n\nexport const buildReport = (): number => ingestRecords();"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('a name merely mentioned outside the module is not consumption', async () => {
		const input = setupRepo({
			sources: [
				['src/ingestion/index.ts', "export { ingestRecords } from './ingestRecords.ts';"],
				['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
				['src/ingestion/common/utils/normalizeRecord.ts', 'export const normalizeRecord = (): number => 1;'],
				['src/reporting/buildReport.ts', '// superseded by ingestRecords\nexport const buildReport = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		// the comment is what the old name-counting version read as a consumer
		expect(findings).toHaveLength(1);
	});

	test('an entry publishing a file that carries its own test is left alone — the test standards required that entry', async () => {
		const input = setupRepo({
			sources: [
				['src/ingestion/index.ts', "export { ingestRecords } from './ingestRecords.ts';"],
				['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
				['src/ingestion/common/utils/normalizeRecord.ts', 'export const normalizeRecord = (): number => 1;'],
				['src/ingestion/ingestRecords.unit.test.ts', "import { ingestRecords } from './index.ts';\n\nexport const proof = (): number => ingestRecords();"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('a parent barrel passing a name through gets no such allowance — the tested file belongs to the child module, not the parent', async () => {
		const input = setupRepo({
			sources: [
				['src/app/index.ts', "export { ingestRecords } from './ingestion/index.ts';"],
				['src/app/ingestion/index.ts', "export { ingestRecords } from './ingestRecords.ts';"],
				['src/app/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
				['src/app/ingestion/common/utils/normalizeRecord.ts', 'export const normalizeRecord = (): number => 1;'],
				['src/app/ingestion/ingestRecords.unit.test.ts', "import { ingestRecords } from './index.ts';\n\nexport const proof = (): number => ingestRecords();"],
				['src/app/common/utils/tidy.ts', 'export const tidy = (): number => 1;'],
				[
					'src/reporting/buildReport.ts',
					"import { ingestRecords } from '../app/ingestion/index.ts';\n\nexport const buildReport = (): number => ingestRecords();",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		// everyone reaches the child barrel; the parent's pass-through serves nobody
		expect(findings).toStrictEqual([
			{
				siteKey: 'barrel-dead-entry:src/app/index.ts',
				files: [{ path: 'src/app/index.ts' }],
				detail: "'ingestRecords' is exported from src/app/index.ts but nothing outside module 'src/app' imports it from there",
				guidance: 'Deliberate public API, or dead? Only the author knows.',
			},
		]);
	});

	test('inside a declared pack, a folder under tests/ is a module whose barrel answers for its entries', async () => {
		const input = setupRepo({
			sources: [
				['standards/tests/unit-testing/index.ts', "export { checkRule } from './check.ts';"],
				['standards/tests/unit-testing/check.ts', 'export const checkRule = (): number => 1;'],
				['standards/tests/unit-testing/rule.ts', 'export const ruleText = (): number => 1;'],
			],
			standardsPacks: ['standards'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'barrel-dead-entry:standards/tests/unit-testing/index.ts',
				files: [{ path: 'standards/tests/unit-testing/index.ts' }],
				detail:
					"'checkRule' is exported from standards/tests/unit-testing/index.ts but nothing outside module 'standards/tests/unit-testing' imports it from there",
				guidance: 'Deliberate public API, or dead? Only the author knows.',
			},
		]);
	});

	test('the same repo with no pack declared above it holds only test files, which map no module at all', async () => {
		const input = setupRepo({
			sources: [
				['standards/tests/unit-testing/index.ts', "export { checkRule } from './check.ts';"],
				['standards/tests/unit-testing/check.ts', 'export const checkRule = (): number => 1;'],
				['standards/tests/unit-testing/rule.ts', 'export const ruleText = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('says nothing about a barrel that hides nothing — no boundary, so no public-surface claim to answer for', async () => {
		const input = setupRepo({
			sources: [
				['src/feature/index.ts', "export { renderGreeting } from './renderGreeting.ts';"],
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
