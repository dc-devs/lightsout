import { describe, expect, test } from '@jest/globals';
import { mapFolderModules } from './mapFolderModules.ts';

/**
 * A repo's file list plus what each barrel re-exports — the caller supplies the
 * second half, since only it knows whether it holds file text or import edges.
 */
const setupRepo = ({ paths, targets = {}, unreadable = [] }: { paths: string[]; targets?: Record<string, string[]>; unreadable?: string[] }) => ({
	files: paths,
	getSurface: ({ barrelPath }: { barrelPath: string }) => ({ targets: new Set(targets[barrelPath] ?? []), complete: !unreadable.includes(barrelPath) }),
	standardsPackages: [],
});

describe('mapFolderModules', () => {
	test('marks a folder whose barrel hides one of its files as a boundary, naming the barrel and its public files', () => {
		const { files, getSurface, standardsPackages } = setupRepo({
			paths: ['src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/parseRow.ts'],
			targets: { 'src/ingestion/index.ts': ['src/ingestion/ingestRecords.ts'] },
		});

		const modules = mapFolderModules({ files, getSurface, standardsPackages });

		expect(modules).toStrictEqual(
			new Map([['src/ingestion', { barrelPath: 'src/ingestion/index.ts', exportedTargets: new Set(['src/ingestion/ingestRecords.ts']) }]]),
		);
	});

	test('leaves out a folder whose barrel re-exports everything in it — hiding nothing marks no boundary', () => {
		const { files, getSurface, standardsPackages } = setupRepo({
			paths: ['src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/parseRow.ts'],
			targets: { 'src/ingestion/index.ts': ['src/ingestion/ingestRecords.ts', 'src/ingestion/parseRow.ts'] },
		});

		const modules = mapFolderModules({ files, getSurface, standardsPackages });

		expect(modules).toStrictEqual(new Map());
	});

	test('counts a folder with its own common/ as a boundary even when its barrel hides nothing', () => {
		const { files, getSurface, standardsPackages } = setupRepo({
			paths: ['src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/common/utils/normalizeRecord.ts'],
			targets: {
				'src/ingestion/index.ts': ['src/ingestion/ingestRecords.ts', 'src/ingestion/common/utils/normalizeRecord.ts'],
			},
		});

		const modules = mapFolderModules({ files, getSurface, standardsPackages });

		expect([...modules.keys()]).toStrictEqual(['src/ingestion']);
	});

	test('never treats a src root barrel as a module — it is the package’s API, not an internal boundary', () => {
		const { files, getSurface, standardsPackages } = setupRepo({
			paths: ['src/index.ts', 'src/bootstrap.ts'],
			targets: { 'src/index.ts': [] },
		});

		const modules = mapFolderModules({ files, getSurface, standardsPackages });

		expect(modules).toStrictEqual(new Map());
	});

	test('never treats a barrel under common/ as a module — common/ is boundary-less by definition', () => {
		const { files, getSurface, standardsPackages } = setupRepo({
			paths: ['src/common/utils/index.ts', 'src/common/utils/formatRate.ts', 'src/common/utils/roundAmount.ts'],
			targets: { 'src/common/utils/index.ts': ['src/common/utils/formatRate.ts'] },
		});

		const modules = mapFolderModules({ files, getSurface, standardsPackages });

		expect(modules).toStrictEqual(new Map());
	});

	test('a file inside a nested module is not an omission of the outer folder, so only the nested one is a boundary', () => {
		const { files, getSurface, standardsPackages } = setupRepo({
			paths: [
				'src/ingestion/index.ts',
				'src/ingestion/ingestRecords.ts',
				'src/ingestion/parser/index.ts',
				'src/ingestion/parser/parseRow.ts',
				'src/ingestion/parser/tokenize.ts',
			],
			targets: {
				'src/ingestion/index.ts': ['src/ingestion/ingestRecords.ts'],
				'src/ingestion/parser/index.ts': ['src/ingestion/parser/parseRow.ts'],
			},
		});

		const modules = mapFolderModules({ files, getSurface, standardsPackages });

		expect([...modules.keys()]).toStrictEqual(['src/ingestion/parser']);
	});

	test('leaves out a folder whose barrel could not be fully read, however much it looks like a boundary', () => {
		// the alias-shaped failure: every re-export unresolved, so the barrel reads
		// as empty and every file in the folder looks hidden. Reporting that is how
		// one rule came to fire on all 225 of a package's tests at once.
		const { files, getSurface, standardsPackages } = setupRepo({
			paths: ['src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/parseRow.ts'],
			targets: { 'src/ingestion/index.ts': [] },
			unreadable: ['src/ingestion/index.ts'],
		});

		const modules = mapFolderModules({ files, getSurface, standardsPackages });

		expect(modules).toStrictEqual(new Map());
	});

	test('leaves out an unreadable barrel even when its own common/ folder would have made it a boundary', () => {
		// hasOwnCommon does not depend on resolution, but every rule downstream
		// still argues from exportedTargets, and a partial set makes those
		// arguments wrong in the direction that invents findings
		const { files, getSurface, standardsPackages } = setupRepo({
			paths: ['src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/common/utils/normalizeRecord.ts'],
			targets: { 'src/ingestion/index.ts': [] },
			unreadable: ['src/ingestion/index.ts'],
		});

		const modules = mapFolderModules({ files, getSurface, standardsPackages });

		expect(modules).toStrictEqual(new Map());
	});

	test('an unexported test or non-TypeScript file is no omission — a barrel never publishes those', () => {
		const { files, getSurface, standardsPackages } = setupRepo({
			paths: ['src/feature/index.ts', 'src/feature/renderGreeting.ts', 'src/feature/renderGreeting.unit.test.ts', 'src/feature/styles.css'],
			targets: { 'src/feature/index.ts': ['src/feature/renderGreeting.ts'] },
		});

		const modules = mapFolderModules({ files, getSurface, standardsPackages });

		expect(modules).toStrictEqual(new Map());
	});
});
