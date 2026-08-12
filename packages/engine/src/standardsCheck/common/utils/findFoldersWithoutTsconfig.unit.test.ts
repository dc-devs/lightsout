import { describe, expect, test } from '@jest/globals';
import { findFoldersWithoutTsconfig } from '@/standardsCheck/common/utils/findFoldersWithoutTsconfig';

/** The run's file list and the tsconfigs it managed to read. */
const setupRun = ({ files, configs }: { files: string[]; configs: string[] }) => ({
	files,
	contents: new Map(configs.map((path) => [path, '{}'])),
});

describe('findFoldersWithoutTsconfig', () => {
	test('names a folder that no tsconfig sits above', () => {
		const { files, contents } = setupRun({ files: ['packages/engine/src/agents/index.ts'], configs: [] });

		const uncovered = findFoldersWithoutTsconfig({ files, contents });

		expect(uncovered).toStrictEqual(['packages/engine/src/agents']);
	});

	test("says nothing when the file's own package carries one", () => {
		const { files, contents } = setupRun({ files: ['packages/engine/src/agents/index.ts'], configs: ['packages/engine/tsconfig.json'] });

		const uncovered = findFoldersWithoutTsconfig({ files, contents });

		expect(uncovered).toStrictEqual([]);
	});

	test('a config at the repo root covers everything below it', () => {
		const { files, contents } = setupRun({ files: ['src/a.ts', 'src/deep/b.ts'], configs: ['tsconfig.json'] });

		const uncovered = findFoldersWithoutTsconfig({ files, contents });

		expect(uncovered).toStrictEqual([]);
	});

	test('reports only the packages actually uncovered, not the whole run', () => {
		const { files, contents } = setupRun({
			files: ['packages/engine/src/a.ts', 'packages/other/src/b.ts'],
			configs: ['packages/engine/tsconfig.json'],
		});

		const uncovered = findFoldersWithoutTsconfig({ files, contents });

		expect(uncovered).toStrictEqual(['packages/other/src']);
	});

	test('collapses many files in one folder to a single entry, since the answer is the same for all of them', () => {
		const { files, contents } = setupRun({ files: ['src/a.ts', 'src/b.ts', 'src/c.ts'], configs: [] });

		const uncovered = findFoldersWithoutTsconfig({ files, contents });

		expect(uncovered).toStrictEqual(['src']);
	});

	test('covers a file sitting at the repo root itself', () => {
		const { files, contents } = setupRun({ files: ['index.ts'], configs: ['tsconfig.json'] });

		const uncovered = findFoldersWithoutTsconfig({ files, contents });

		expect(uncovered).toStrictEqual([]);
	});
});
