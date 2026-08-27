import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from '@jest/globals';
import { runSprawlDriver } from '#tests/helpers/sprawl/runSprawlDriver.ts';
import { seedSprawlRepo } from '#tests/helpers/sprawl/seedSprawlRepo.ts';

// What the chart is allowed to draw at each commit: the TypeScript files with
// their line counts, and every folder's direct-file population counted the way
// the crowded-folder check counts it. A standards pack's own counter-examples
// are pruned, because a pack's deliberately oversized fixture is a sample of
// the rule rather than this repository's sprawl.

const lines = ({ count }: { count: number }) => `${Array.from({ length: count }, (_, index) => `line ${index}`).join('\n')}\n`;
const repos: string[] = [];

const setupTreeRepo = ({ later }: { later?: Record<string, string> } = {}) => {
	const commits: { message: string; at: string; write: Record<string, string> }[] = [
		{
			message: 'the whole tree',
			at: '2026-01-01T00:00:00Z',
			write: {
				'packages/app/src/a.ts': lines({ count: 3 }),
				'packages/app/src/b.tsx': lines({ count: 2 }),
				'packages/app/src/a.unit.test.ts': lines({ count: 5 }),
				'packages/app/src/types.d.ts': lines({ count: 4 }),
				'packages/app/src/notes.md': lines({ count: 1 }),
				'packages/app/tests/helper.ts': lines({ count: 2 }),
				'packages/pack/lightsout-standards.json': '{}\n',
				'packages/pack/rules/check.ts': lines({ count: 6 }),
				'packages/pack/rules/fixtures/fail/huge.ts': lines({ count: 9 }),
				'packages/pack/tests/x.ts': lines({ count: 7 }),
				'packages/pack/__mocks__/y.ts': lines({ count: 8 }),
			},
		},
	];

	if (later !== undefined) {
		commits.push({ message: 'a later change', at: '2026-01-02T00:00:00Z', write: later });
	}

	const cwd = seedSprawlRepo({ commits });

	repos.push(cwd);

	return { cwd };
};

const readTrees = ({ cwd }: { cwd: string }) =>
	runSprawlDriver<{ files: Record<string, number>; folders: Record<string, number> }[]>({
		cwd,
		body: [
			"import { readSprawlCommits } from './scripts/readSprawlCommits.mjs';",
			"import { readSprawlTrees } from './scripts/readSprawlTrees.mjs';",
			'',
			'const commits = readSprawlCommits({ repoRoot: import.meta.dirname });',
			'const trees = readSprawlTrees({ repoRoot: import.meta.dirname, commits });',
			'',
			'report(trees.map((tree) => ({ files: Object.fromEntries(tree.files), folders: Object.fromEntries(tree.folders) })));',
		].join('\n'),
	});

afterAll(() => {
	for (const cwd of repos) {
		rmSync(join(cwd, '..'), { recursive: true, force: true });
	}
});

describe('readSprawlTrees', () => {
	test('measures TypeScript source only, leaving out co-located unit tests, declaration files and a pack fixture', () => {
		const { cwd } = setupTreeRepo();

		const trees = readTrees({ cwd });

		expect(trees[0].files).toStrictEqual({
			'packages/app/src/a.ts': 3,
			'packages/app/src/b.tsx': 2,
			'packages/app/tests/helper.ts': 2,
			'packages/pack/rules/check.ts': 6,
			'packages/pack/tests/x.ts': 7,
			'packages/pack/__mocks__/y.ts': 8,
		});
	});

	test('counts a folder the way the crowded-folder check counts it: direct non-test files of any type, no subfolders', () => {
		const { cwd } = setupTreeRepo();

		const trees = readTrees({ cwd });

		expect(trees[0].folders).toStrictEqual({
			'packages/app/src': 4,
			'packages/pack': 1,
			'packages/pack/rules': 1,
			'packages/pack/tests': 1,
		});
	});

	test('measures each commit on its own, so a file that grew is taller in the later frame and an untouched one is unmoved', () => {
		const { cwd } = setupTreeRepo({ later: { 'packages/app/src/a.ts': lines({ count: 11 }) } });

		const trees = readTrees({ cwd });

		expect(trees.map((tree) => ({ grew: tree.files['packages/app/src/a.ts'], untouched: tree.files['packages/pack/rules/check.ts'] }))).toStrictEqual([
			{ grew: 3, untouched: 6 },
			{ grew: 11, untouched: 6 },
		]);
	});
});
