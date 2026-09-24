import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readGitStagedChange } from '#src/common/git/readGitStagedChange.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/**
 * A committed consumer repo with changes staged the way `commitWorkOrderWork`
 * stages them (`git add -A -- .`). `staged` plants files by repo-root-relative
 * path before staging (overwriting a committed one edits it, a new one adds
 * it); `unstaged` plants files after staging, so they stay out of the index.
 */
const setupStagedRepo = ({
	git = true,
	staged = {},
	unstaged = {},
}: {
	git?: boolean;
	staged?: Record<string, string>;
	unstaged?: Record<string, string>;
} = {}) => {
	const cwd = setupConsumerRepo({ git });
	const plant = (files: Record<string, string>) => {
		for (const [path, content] of Object.entries(files)) {
			mkdirSync(dirname(join(cwd, path)), { recursive: true });
			writeFileSync(join(cwd, path), content);
		}
	};

	plant(staged);
	if (git) {
		execFileSync('git', ['add', '-A', '--', '.'], { cwd });
	}
	plant(unstaged);

	return { cwd };
};

describe('readGitStagedChange', () => {
	test('readGitStagedChange: lists a staged new file and a staged edit in both the stat and the diff, and nothing unstaged', async () => {
		const { cwd } = setupStagedRepo({
			staged: { 'src/added.ts': 'export const added = 1;\n', 'src/index.js': 'export const one = 2;\n' },
			unstaged: { 'plan.md': '# Plan: an edit nobody staged\n' },
		});

		const change = await readGitStagedChange({ cwd, maxDiffLength: 60_000 });

		expect(change).toEqual({
			stat: expect.stringMatching(/src\/added\.ts[\s\S]*src\/index\.js/),
			diff: expect.stringMatching(/src\/added\.ts[\s\S]*src\/index\.js/),
			truncated: false,
		});
		expect(`${change?.stat}\n${change?.diff}`).not.toContain('plan.md');
	});

	test('readGitStagedChange: cuts a diff longer than the limit to exactly the limit and marks it truncated while the stat still names every file', async () => {
		const { cwd } = setupStagedRepo({
			staged: {
				'src/big.ts': Array.from({ length: 2000 }, (_, index) => `export const value${index} = ${index};\n`).join(''),
				'src/index.js': 'export const one = 2;\n',
			},
		});

		const change = await readGitStagedChange({ cwd, maxDiffLength: 500 });

		expect(change?.diff).toHaveLength(500);
		expect(change?.truncated).toBe(true);
		expect(change?.stat).toEqual(expect.stringMatching(/src\/big\.ts[\s\S]*src\/index\.js/));
	});

	test('readGitStagedChange: answers undefined for a directory git cannot read', async () => {
		const { cwd } = setupStagedRepo({ git: false, staged: { 'src/added.ts': 'export const added = 1;\n' } });

		const change = await readGitStagedChange({ cwd, maxDiffLength: 60_000 });

		// no worktree means no staged change to describe — never an empty one
		expect(change).toBe(undefined);
	});
});
