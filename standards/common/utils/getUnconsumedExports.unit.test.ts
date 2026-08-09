import { expect, describe, test } from '@jest/globals';
import { getUnconsumedExports } from './getUnconsumedExports.ts';

/** A repo as a file-text rule receives it: the files being judged, and text for everything that may reference them. */
const setupRepo = ({ scope, contents }: { scope?: string[]; contents: Array<[string, string]> }) => ({
	files: scope ?? contents.map(([path]) => path),
	contents: new Map(contents),
	standardsPackages: [],
});

describe('getUnconsumedExports', () => {
	test('reports an export nothing else mentions, with nothing having reached it', () => {
		const found = getUnconsumedExports(
			setupRepo({ contents: [['src/ingestion/ingestRecords.ts', 'export const ingestRecords = (): number => 1;']] }),
		);

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
