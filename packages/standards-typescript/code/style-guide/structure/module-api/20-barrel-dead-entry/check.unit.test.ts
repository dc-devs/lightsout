import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupTypeCheckerInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

/** A repo as the engine hands it to a type-checker rule, with the test files told apart by name. */
const setupRepo = ({
	sources,
	standardsPacks = [],
	dependencies = [],
}: {
	sources: Array<[string, string]>;
	standardsPacks?: string[];
	dependencies?: Array<[string, string[]]>;
}) => {
	const paths = sources.map(([path]) => path);

	return setupTypeCheckerInput({
		sources,
		source: paths.filter((path) => !path.includes('.test.')),
		tests: paths.filter((path) => path.includes('.test.')),
		files: paths,
		standardsPacks,
		dependencies,
	});
};

describe('barrel-dead-entry check', () => {
	test('asks for a type checker, since the verdict turns on which module a name was imported FROM', () => {
		expect(check.inputKind).toBe('type-checker');
	});

	test('reports a published name nothing outside the module imports', async () => {
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
				detail: "'ingestRecords' is exported from src/ingestion/index.ts but nothing outside module 'src/ingestion' imports it",
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
			"'ingestRecords', 'parseRows' are exported from src/ingestion/index.ts but nothing outside module 'src/ingestion' imports them",
		);
	});

	test('an outside module importing the name from the file that declares it silences it', async () => {
		const input = setupRepo({
			sources: [
				['src/ingestion/index.ts', "export { ingestRecords } from './ingestRecords.ts';"],
				['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
				['src/ingestion/common/utils/normalizeRecord.ts', 'export const normalizeRecord = (): number => 1;'],
				[
					'src/reporting/buildReport.ts',
					"import { ingestRecords } from '../ingestion/ingestRecords.ts';\n\nexport const buildReport = (): number => ingestRecords();",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('follows a renamed entry to the name its declaring file exports', async () => {
		const input = setupRepo({
			sources: [
				['src/ingestion/index.ts', "export { ingestRecords as ingest } from './ingestRecords.ts';"],
				['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
				['src/ingestion/common/utils/normalizeRecord.ts', 'export const normalizeRecord = (): number => 1;'],
				[
					'src/reporting/buildReport.ts',
					"import { ingestRecords } from '../ingestion/ingestRecords.ts';\n\nexport const buildReport = (): number => ingestRecords();",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('an import of another name from the declaring file leaves the entry unused', async () => {
		const input = setupRepo({
			sources: [
				['src/ingestion/index.ts', "export { ingestRecords } from './ingestRecords.ts';"],
				['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;\nexport const recordLimit = 10;'],
				['src/ingestion/common/utils/normalizeRecord.ts', 'export const normalizeRecord = (): number => 1;'],
				[
					'src/reporting/buildReport.ts',
					"import { recordLimit } from '../ingestion/ingestRecords.ts';\n\nexport const buildReport = (): number => recordLimit;",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map((finding) => finding.detail)).toStrictEqual([
			"'ingestRecords' is exported from src/ingestion/index.ts but nothing outside module 'src/ingestion' imports it",
		]);
	});

	test('an import the compiler cannot place, naming the entry, is counted as a possible use — this run cannot say otherwise', async () => {
		const input = setupRepo({
			sources: [
				['src/ingestion/index.ts', "export { ingestRecords } from './ingestRecords.ts';"],
				['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
				['src/ingestion/common/utils/normalizeRecord.ts', 'export const normalizeRecord = (): number => 1;'],
				[
					'src/reporting/buildReport.ts',
					"import { ingestRecords } from 'unplaced-alias/ingestion';\n\nexport const buildReport = (): number => ingestRecords();",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('an outside module importing the name through the barrel still counts as a use', async () => {
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
				[
					'src/ingestion/ingestRecords.unit.test.ts',
					"import { ingestRecords } from './ingestRecords.ts';\n\nexport const proof = (): number => ingestRecords();",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('a parent barrel passing a name through is in use when something outside the parent imports the declaring file', async () => {
		const input = setupRepo({
			sources: [
				['src/app/index.ts', "export { ingestRecords } from './ingestion/index.ts';"],
				['src/app/ingestion/index.ts', "export { ingestRecords } from './ingestRecords.ts';"],
				['src/app/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
				['src/app/ingestion/common/utils/normalizeRecord.ts', 'export const normalizeRecord = (): number => 1;'],
				['src/app/common/utils/tidy.ts', 'export const tidy = (): number => 1;'],
				[
					'src/reporting/buildReport.ts',
					"import { ingestRecords } from '../app/ingestion/ingestRecords.ts';\n\nexport const buildReport = (): number => ingestRecords();",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		// the parent's entry is what lets reporting, outside src/app, import the file
		expect(findings).toStrictEqual([]);
	});

	test('a parent barrel passing a name through gets no test allowance and no credit for its own nested users — the tested file belongs to the child module', async () => {
		const input = setupRepo({
			sources: [
				['src/app/index.ts', "export { ingestRecords } from './ingestion/index.ts';"],
				['src/app/ingestion/index.ts', "export { ingestRecords } from './ingestRecords.ts';"],
				['src/app/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
				['src/app/ingestion/common/utils/normalizeRecord.ts', 'export const normalizeRecord = (): number => 1;'],
				[
					'src/app/ingestion/ingestRecords.unit.test.ts',
					"import { ingestRecords } from './ingestRecords.ts';\n\nexport const proof = (): number => ingestRecords();",
				],
				['src/app/common/utils/tidy.ts', 'export const tidy = (): number => 1;'],
				['src/app/runApp.ts', "import { ingestRecords } from './ingestion/ingestRecords.ts';\n\nexport const runApp = (): number => ingestRecords();"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		// src/app's own file uses the child's entry; nothing outside src/app needs the parent's
		expect(findings).toStrictEqual([
			{
				siteKey: 'barrel-dead-entry:src/app/index.ts',
				files: [{ path: 'src/app/index.ts' }],
				detail: "'ingestRecords' is exported from src/app/index.ts but nothing outside module 'src/app' imports it",
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
				detail: "'checkRule' is exported from standards/tests/unit-testing/index.ts but nothing outside module 'standards/tests/unit-testing' imports it",
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

	test('a router root’s index.tsx is a route the framework loads, so nothing it names is a public-surface claim', async () => {
		const input = setupRepo({
			sources: [
				['src/routes/index.tsx', "export { Route } from './home.tsx';"],
				['src/routes/home.tsx', "export const Route = { path: '/' };"],
				['src/routes/runs.tsx', "export const RunsRoute = { path: '/runs' };"],
			],
			dependencies: [['.', ['@tanstack/react-router']]],
		});

		const findings = await check.run({ input, settings: {} });

		// read as a barrel it hides runs.tsx, which maps src/routes as a module
		// whose entry nothing outside imports — a finding against a file the
		// framework, not the author, put there
		expect(findings).toStrictEqual([]);
	});

	test('the same tree in a package declaring no router is an ordinary module whose barrel answers for its entry', async () => {
		const input = setupRepo({
			sources: [
				['src/routes/index.tsx', "export { Route } from './home.tsx';"],
				['src/routes/home.tsx', "export const Route = { path: '/' };"],
				['src/routes/runs.tsx', "export const RunsRoute = { path: '/runs' };"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'barrel-dead-entry:src/routes/index.tsx',
				files: [{ path: 'src/routes/index.tsx' }],
				detail: "'Route' is exported from src/routes/index.tsx but nothing outside module 'src/routes' imports it",
				guidance: 'Deliberate public API, or dead? Only the author knows.',
			},
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
