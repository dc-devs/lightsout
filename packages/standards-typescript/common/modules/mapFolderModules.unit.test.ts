import { describe, expect, test } from '@jest/globals';
import { mapFolderModules } from './mapFolderModules.ts';

/**
 * A repo's file list plus what each barrel re-exports — the caller supplies the
 * second half, since only it knows whether it holds file text or import edges.
 */
const setupRepo = ({
	paths,
	targets = {},
	unreadable = [],
	standardsPacks = [],
}: {
	paths: string[];
	targets?: Record<string, string[]>;
	unreadable?: string[];
	standardsPacks?: string[];
}) => ({
	files: paths,
	getSurface: ({ barrelPath }: { barrelPath: string }) => ({ targets: new Set(targets[barrelPath] ?? []), complete: !unreadable.includes(barrelPath) }),
	standardsPacks,
});

describe('mapFolderModules', () => {
	test('marks a folder whose barrel hides one of its files as a boundary, naming the barrel and its public files', () => {
		const { files, getSurface, standardsPacks } = setupRepo({
			paths: ['src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/parseRow.ts'],
			targets: { 'src/ingestion/index.ts': ['src/ingestion/ingestRecords.ts'] },
		});

		const modules = mapFolderModules({ files, getSurface, standardsPacks });

		expect(modules).toStrictEqual(
			new Map([['src/ingestion', { barrelPath: 'src/ingestion/index.ts', exportedTargets: new Set(['src/ingestion/ingestRecords.ts']) }]]),
		);
	});

	test('leaves out a folder whose barrel re-exports everything in it — hiding nothing marks no boundary', () => {
		const { files, getSurface, standardsPacks } = setupRepo({
			paths: ['src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/parseRow.ts'],
			targets: { 'src/ingestion/index.ts': ['src/ingestion/ingestRecords.ts', 'src/ingestion/parseRow.ts'] },
		});

		const modules = mapFolderModules({ files, getSurface, standardsPacks });

		expect(modules).toStrictEqual(new Map());
	});

	test('counts a folder with its own common/ as a boundary even when its barrel hides nothing', () => {
		const { files, getSurface, standardsPacks } = setupRepo({
			paths: ['src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/common/utils/normalizeRecord.ts'],
			targets: {
				'src/ingestion/index.ts': ['src/ingestion/ingestRecords.ts', 'src/ingestion/common/utils/normalizeRecord.ts'],
			},
		});

		const modules = mapFolderModules({ files, getSurface, standardsPacks });

		expect([...modules.keys()]).toStrictEqual(['src/ingestion']);
	});

	test('never treats a src root barrel as a module — it is the package’s API, not an internal boundary', () => {
		const { files, getSurface, standardsPacks } = setupRepo({
			paths: ['src/index.ts', 'src/bootstrap.ts'],
			targets: { 'src/index.ts': [] },
		});

		const modules = mapFolderModules({ files, getSurface, standardsPacks });

		expect(modules).toStrictEqual(new Map());
	});

	test('never treats a barrel under common/ as a module — common/ is boundary-less by definition', () => {
		const { files, getSurface, standardsPacks } = setupRepo({
			paths: ['src/common/utils/index.ts', 'src/common/utils/formatRate.ts', 'src/common/utils/roundAmount.ts'],
			targets: { 'src/common/utils/index.ts': ['src/common/utils/formatRate.ts'] },
		});

		const modules = mapFolderModules({ files, getSurface, standardsPacks });

		expect(modules).toStrictEqual(new Map());
	});

	test('a file inside a nested module is not an omission of the outer folder, so only the nested one is a boundary', () => {
		const { files, getSurface, standardsPacks } = setupRepo({
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

		const modules = mapFolderModules({ files, getSurface, standardsPacks });

		expect([...modules.keys()]).toStrictEqual(['src/ingestion/parser']);
	});

	test('leaves out a folder whose barrel could not be fully read, however much it looks like a boundary', () => {
		// the alias-shaped failure: every re-export unresolved, so the barrel reads
		// as empty and every file in the folder looks hidden. Reporting that is how
		// one rule came to fire on all 225 of a package's tests at once.
		const { files, getSurface, standardsPacks } = setupRepo({
			paths: ['src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/parseRow.ts'],
			targets: { 'src/ingestion/index.ts': [] },
			unreadable: ['src/ingestion/index.ts'],
		});

		const modules = mapFolderModules({ files, getSurface, standardsPacks });

		expect(modules).toStrictEqual(new Map());
	});

	test('leaves out an unreadable barrel even when its own common/ folder would have made it a boundary', () => {
		// hasOwnCommon does not depend on resolution, but every rule downstream
		// still argues from exportedTargets, and a partial set makes those
		// arguments wrong in the direction that invents findings
		const { files, getSurface, standardsPacks } = setupRepo({
			paths: ['src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/common/utils/normalizeRecord.ts'],
			targets: { 'src/ingestion/index.ts': [] },
			unreadable: ['src/ingestion/index.ts'],
		});

		const modules = mapFolderModules({ files, getSurface, standardsPacks });

		expect(modules).toStrictEqual(new Map());
	});

	test('inside a declared pack, the files under tests/ are ordinary source, so hiding one marks a boundary', () => {
		const { files, getSurface, standardsPacks } = setupRepo({
			paths: ['standards/tests/unit-testing/index.ts', 'standards/tests/unit-testing/check.ts', 'standards/tests/unit-testing/rule.ts'],
			targets: { 'standards/tests/unit-testing/index.ts': ['standards/tests/unit-testing/check.ts'] },
			standardsPacks: ['standards'],
		});

		const modules = mapFolderModules({ files, getSurface, standardsPacks });

		expect(modules).toStrictEqual(
			new Map([
				[
					'standards/tests/unit-testing',
					{ barrelPath: 'standards/tests/unit-testing/index.ts', exportedTargets: new Set(['standards/tests/unit-testing/check.ts']) },
				],
			]),
		);
	});

	test('the same folder with no pack declared above it holds only test files, which omit nothing', () => {
		const { files, getSurface, standardsPacks } = setupRepo({
			paths: ['standards/tests/unit-testing/index.ts', 'standards/tests/unit-testing/check.ts', 'standards/tests/unit-testing/rule.ts'],
			targets: { 'standards/tests/unit-testing/index.ts': ['standards/tests/unit-testing/check.ts'] },
		});

		const modules = mapFolderModules({ files, getSurface, standardsPacks });

		expect(modules).toStrictEqual(new Map());
	});

	test('a folder whose only barrel the framework loads is no module — a router root’s index.tsx is a route', () => {
		const { files, getSurface, standardsPacks } = setupRepo({
			paths: ['src/routes/index.tsx', 'src/routes/__root.tsx', 'src/routes/runs.$runId.tsx'],
			targets: { 'src/routes/index.tsx': [] },
		});

		const modules = mapFolderModules({ files, getSurface, standardsPacks, isFrameworkLoaded: ({ path }) => path.startsWith('src/routes/') });

		// read as a barrel it publishes nothing, which would make every route in
		// the directory somebody's unexported internal
		expect(modules).toStrictEqual(new Map());
	});

	test('the same tree with no framework answering reads that index.tsx as a barrel, exactly as before', () => {
		const { files, getSurface, standardsPacks } = setupRepo({
			paths: ['src/routes/index.tsx', 'src/routes/__root.tsx', 'src/routes/runs.$runId.tsx'],
			targets: { 'src/routes/index.tsx': [] },
		});

		const modules = mapFolderModules({ files, getSurface, standardsPacks });

		expect([...modules.keys()]).toStrictEqual(['src/routes']);
	});

	test('a framework answering per file leaves an ordinary barrel a boundary — it discriminates, it does not blanket-suppress', () => {
		const { files, getSurface, standardsPacks } = setupRepo({
			paths: ['src/routes/index.tsx', 'src/routes/runs.$runId.tsx', 'src/ingestion/index.ts', 'src/ingestion/ingestRecords.ts', 'src/ingestion/parseRow.ts'],
			targets: { 'src/routes/index.tsx': [], 'src/ingestion/index.ts': ['src/ingestion/ingestRecords.ts'] },
		});

		const modules = mapFolderModules({ files, getSurface, standardsPacks, isFrameworkLoaded: ({ path }) => path.startsWith('src/routes/') });

		expect(modules).toStrictEqual(
			new Map([['src/ingestion', { barrelPath: 'src/ingestion/index.ts', exportedTargets: new Set(['src/ingestion/ingestRecords.ts']) }]]),
		);
	});

	test('a folder the framework mandates as a module is a boundary though its barrel hides nothing', () => {
		// the omission test infers a boundary from concealment, which is wrong for
		// a folder a framework requires: it holds one file the day it is made
		const { files, getSurface, standardsPacks } = setupRepo({
			paths: ['src/features/app/screens/RunsIndex/index.ts', 'src/features/app/screens/RunsIndex/RunsIndex.tsx'],
			targets: { 'src/features/app/screens/RunsIndex/index.ts': ['src/features/app/screens/RunsIndex/RunsIndex.tsx'] },
		});

		const modules = mapFolderModules({
			files,
			getSurface,
			standardsPacks,
			isMandatedModule: ({ folder }) => folder === 'src/features/app/screens/RunsIndex',
		});

		expect(modules).toStrictEqual(
			new Map([
				[
					'src/features/app/screens/RunsIndex',
					{ barrelPath: 'src/features/app/screens/RunsIndex/index.ts', exportedTargets: new Set(['src/features/app/screens/RunsIndex/RunsIndex.tsx']) },
				],
			]),
		);
	});

	test('a mandate cannot rescue a barrel whose surface could not be fully read', () => {
		const { files, getSurface, standardsPacks } = setupRepo({
			paths: ['src/features/app/screens/RunsIndex/index.ts', 'src/features/app/screens/RunsIndex/RunsIndex.tsx'],
			targets: { 'src/features/app/screens/RunsIndex/index.ts': [] },
			unreadable: ['src/features/app/screens/RunsIndex/index.ts'],
		});

		const modules = mapFolderModules({ files, getSurface, standardsPacks, isMandatedModule: () => true });

		expect(modules).toStrictEqual(new Map());
	});

	test('an unexported test or non-TypeScript file is no omission — a barrel never publishes those', () => {
		const { files, getSurface, standardsPacks } = setupRepo({
			paths: ['src/feature/index.ts', 'src/feature/renderGreeting.ts', 'src/feature/renderGreeting.unit.test.ts', 'src/feature/styles.css'],
			targets: { 'src/feature/index.ts': ['src/feature/renderGreeting.ts'] },
		});

		const modules = mapFolderModules({ files, getSurface, standardsPacks });

		expect(modules).toStrictEqual(new Map());
	});
});
