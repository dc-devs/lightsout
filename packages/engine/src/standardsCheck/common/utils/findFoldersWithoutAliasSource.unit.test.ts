import { describe, expect, test } from '@jest/globals';
import { findFoldersWithoutAliasSource } from '#src/standardsCheck/common/utils/findFoldersWithoutAliasSource.ts';

/** The run's file list, the tsconfigs it managed to read, and any manifests it found. */
const setupRun = ({ files, configs, manifests = [] }: { files: string[]; configs: string[]; manifests?: Array<[string, string]> }) => ({
	files,
	contents: new Map([...configs.map((path): [string, string] => [path, '{}']), ...manifests]),
});

const aliasManifest = '{ "imports": { "#src/*": "./src/*" } }';

describe('findFoldersWithoutAliasSource', () => {
	test('names a folder that no alias declaration sits above', () => {
		const { files, contents } = setupRun({ files: ['packages/engine/src/agents/index.ts'], configs: [] });

		const uncovered = findFoldersWithoutAliasSource({ files, contents });

		expect(uncovered).toStrictEqual(['packages/engine/src/agents']);
	});

	test("says nothing when the file's own package carries one", () => {
		const { files, contents } = setupRun({ files: ['packages/engine/src/agents/index.ts'], configs: ['packages/engine/tsconfig.json'] });

		const uncovered = findFoldersWithoutAliasSource({ files, contents });

		expect(uncovered).toStrictEqual([]);
	});

	test('a config at the repo root covers everything below it', () => {
		const { files, contents } = setupRun({ files: ['src/a.ts', 'src/deep/b.ts'], configs: ['tsconfig.json'] });

		const uncovered = findFoldersWithoutAliasSource({ files, contents });

		expect(uncovered).toStrictEqual([]);
	});

	test('reports only the packages actually uncovered, not the whole run', () => {
		const { files, contents } = setupRun({
			files: ['packages/engine/src/a.ts', 'packages/other/src/b.ts'],
			configs: ['packages/engine/tsconfig.json'],
		});

		const uncovered = findFoldersWithoutAliasSource({ files, contents });

		expect(uncovered).toStrictEqual(['packages/other/src']);
	});

	test('collapses many files in one folder to a single entry, since the answer is the same for all of them', () => {
		const { files, contents } = setupRun({ files: ['src/a.ts', 'src/b.ts', 'src/c.ts'], configs: [] });

		const uncovered = findFoldersWithoutAliasSource({ files, contents });

		expect(uncovered).toStrictEqual(['src']);
	});

	test("a manifest declaring imports covers the folders below it, since that is where the package's aliases are", () => {
		const { files, contents } = setupRun({
			files: ['packages/engine/src/agents/index.ts'],
			configs: [],
			manifests: [['packages/engine/package.json', aliasManifest]],
		});

		const uncovered = findFoldersWithoutAliasSource({ files, contents });

		expect(uncovered).toStrictEqual([]);
	});

	test('a manifest that declares no imports leaves the folder uncovered, since every package ships one', () => {
		const { files, contents } = setupRun({
			files: ['packages/engine/src/agents/index.ts'],
			configs: [],
			manifests: [['packages/engine/package.json', '{ "name": "@lightsout/engine" }']],
		});

		const uncovered = findFoldersWithoutAliasSource({ files, contents });

		expect(uncovered).toStrictEqual(['packages/engine/src/agents']);
	});

	test('unreadable manifest text is no answer, so the folder stays uncovered', () => {
		const { files, contents } = setupRun({
			files: ['packages/engine/src/agents/index.ts'],
			configs: [],
			manifests: [['packages/engine/package.json', '{ "imports": ']],
		});

		const uncovered = findFoldersWithoutAliasSource({ files, contents });

		expect(uncovered).toStrictEqual(['packages/engine/src/agents']);
	});

	test('an imports field that is not a map is no answer either', () => {
		const { files, contents } = setupRun({
			files: ['packages/engine/src/agents/index.ts'],
			configs: [],
			manifests: [['packages/engine/package.json', '{ "imports": "./src/*" }']],
		});

		const uncovered = findFoldersWithoutAliasSource({ files, contents });

		expect(uncovered).toStrictEqual(['packages/engine/src/agents']);
	});

	test('covers a file sitting at the repo root itself', () => {
		const { files, contents } = setupRun({ files: ['index.ts'], configs: ['tsconfig.json'] });

		const uncovered = findFoldersWithoutAliasSource({ files, contents });

		expect(uncovered).toStrictEqual([]);
	});
});
