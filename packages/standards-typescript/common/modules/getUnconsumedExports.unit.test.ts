import { describe, expect, test } from '@jest/globals';
import { getUnconsumedExports } from './getUnconsumedExports.ts';

/** A repo as a file-text rule receives it: the files being judged, and text for everything that may reference them. */
const setupRepo = ({ scope, contents, standardsPacks = [] }: { scope?: string[]; contents: Array<[string, string]>; standardsPacks?: string[] }) => ({
	files: scope ?? contents.map(([path]) => path),
	contents: new Map(contents),
	standardsPacks,
});

describe('getUnconsumedExports', () => {
	test('reports an export nothing else mentions, with nothing having reached it', () => {
		const found = getUnconsumedExports(setupRepo({ contents: [['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;']] }));

		expect(found).toStrictEqual([{ file: 'src/ingestion/ingestRecords.ts', name: 'ingestRecords', reachedBy: { barrel: false, test: false } }]);
	});

	test('says a barrel reached an export the barrel publishes', () => {
		const found = getUnconsumedExports(
			setupRepo({
				contents: [
					['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
					['src/ingestion/index.ts', "export { ingestRecords } from './ingestRecords';"],
				],
			}),
		);

		expect(found).toStrictEqual([{ file: 'src/ingestion/ingestRecords.ts', name: 'ingestRecords', reachedBy: { barrel: true, test: false } }]);
	});

	test('says a test reached an export only its own tests mention', () => {
		const found = getUnconsumedExports(
			setupRepo({
				contents: [
					['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
					['src/ingestion/ingestRecords.unit.test.ts', 'ingestRecords();'],
				],
			}),
		);

		expect(found).toStrictEqual([{ file: 'src/ingestion/ingestRecords.ts', name: 'ingestRecords', reachedBy: { barrel: false, test: true } }]);
	});

	test('reports nothing when a production file references the export', () => {
		const found = getUnconsumedExports(
			setupRepo({
				contents: [
					['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
					['src/app.ts', 'ingestRecords();'],
				],
			}),
		);

		expect(found).toStrictEqual([]);
	});

	test('an index file that only imports and runs is an ordinary consumer, not a barrel', () => {
		const found = getUnconsumedExports(
			setupRepo({
				contents: [
					['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
					['src/index.ts', "import { ingestRecords } from './ingestion/ingestRecords';\ningestRecords();"],
				],
			}),
		);

		// counting that dispatcher as a barrel would read every command it invokes
		// as "published but unconsumed"
		expect(found).toStrictEqual([]);
	});

	test('declares nothing from a barrel or a test — those names belong elsewhere', () => {
		const found = getUnconsumedExports(
			setupRepo({
				contents: [
					['src/ingestion/index.ts', 'export const barrelOwnName = 1;'],
					['src/ingestion/thing.unit.test.ts', 'export const testOwnHelper = 1;'],
				],
			}),
		);

		expect(found).toStrictEqual([]);
	});

	test('skips names under four characters, which collide with ordinary words too often to measure', () => {
		const found = getUnconsumedExports(setupRepo({ contents: [['src/run.ts', 'export const run = (): number => 1;']] }));

		expect(found).toStrictEqual([]);
	});

	test('judges only the files in scope, though anything may reference them', () => {
		const found = getUnconsumedExports(
			setupRepo({
				scope: ['src/ingestion/ingestRecords.ts'],
				contents: [
					['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
					['vendor/untouched.ts', 'export const vendorExport = (): number => 2;'],
				],
			}),
		);

		// vendorExport is unconsumed too, but out of scope and so not this run's business
		expect(found).toStrictEqual([{ file: 'src/ingestion/ingestRecords.ts', name: 'ingestRecords', reachedBy: { barrel: false, test: false } }]);
	});

	test('inside a declared pack, a rule under tests/ declares an export like any other source file', () => {
		const found = getUnconsumedExports(
			setupRepo({
				contents: [['standards/tests/unit-testing/10-rule/check.ts', 'export const checkRule = (): number => 1;']],
				standardsPacks: ['standards'],
			}),
		);

		expect(found).toStrictEqual([{ file: 'standards/tests/unit-testing/10-rule/check.ts', name: 'checkRule', reachedBy: { barrel: false, test: false } }]);
	});

	test('the same path with no pack declared above it is a test, whose helpers are its own', () => {
		const found = getUnconsumedExports(
			setupRepo({ contents: [['standards/tests/unit-testing/10-rule/check.ts', 'export const checkRule = (): number => 1;']] }),
		);

		expect(found).toStrictEqual([]);
	});

	test('a reference from inside a declared pack’s tests/ is an ordinary source reference, not a test reaching it', () => {
		const found = getUnconsumedExports(
			setupRepo({
				contents: [
					['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
					['standards/tests/unit-testing/10-rule/check.ts', 'ingestRecords();'],
				],
				standardsPacks: ['standards'],
			}),
		);

		// with no pack declared the same file would count as a test, and the export
		// would be reported as reached by tests alone
		expect(found).toStrictEqual([]);
	});

	test('a mention in a comment counts as a reference, which is what keeps the verdict rare', () => {
		const found = getUnconsumedExports(
			setupRepo({
				contents: [
					['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;'],
					['src/app.ts', '// ingestRecords is called by the scheduler\n'],
				],
			}),
		);

		expect(found).toStrictEqual([]);
	});
});
