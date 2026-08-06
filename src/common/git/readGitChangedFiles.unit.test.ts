import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { readGitChangedFiles } from '@/common/git/readGitChangedFiles';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/**
 * A committed consumer repo plus working-tree edits. `write` plants files by
 * repo-root-relative path (overwriting a committed one makes it modified,
 * a new one makes it untracked), `rename` stages a `git mv`, and `at` anchors
 * the read at a subdirectory — the nested-consumer case where git's
 * repo-root-relative paths need the prefix stripped.
 */
const setupChangedRepo = ({
	git = true,
	write = {},
	rename,
	at,
}: {
	git?: boolean;
	write?: Record<string, string>;
	rename?: { from: string; to: string };
	at?: string;
} = {}) => {
	const root = setupConsumerRepo({ git });

	for (const [path, content] of Object.entries(write)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}

	if (rename) {
		execSync(`git mv ${rename.from} ${rename.to}`, { cwd: root });
	}

	return { cwd: at ? join(root, at) : root };
};

describe('readGitChangedFiles', () => {
	test('a clean worktree reports no changed files', async () => {
		const { cwd } = setupChangedRepo();

		const changed = await readGitChangedFiles({ cwd });

		// a clean tree is an empty list, never undefined — undefined means "no git
		// truth available"
		expect(changed).toStrictEqual([]);
	});

	test('modified and untracked files are both reported, repo-relative', async () => {
		const { cwd } = setupChangedRepo({ write: { 'src/index.js': 'export const one = 2;\n', 'src/added.ts': 'export const added = 1;\n' } });

		const changed = await readGitChangedFiles({ cwd });

		expect([...(changed ?? [])].sort()).toStrictEqual(['src/added.ts', 'src/index.js']);
	});

	test('run state under .lightsout/ is never reported as a changed file', async () => {
		const { cwd } = setupChangedRepo({
			write: { '.lightsout/runs/r1/manifest.json': '{}\n', '.lightsout/scan.json': '{}\n', 'src/added.ts': 'export const added = 1;\n' },
		});

		const changed = await readGitChangedFiles({ cwd });

		// the engine's own run state is never attributed to the agent
		expect(changed).toStrictEqual(['src/added.ts']);
	});

	test('a staged rename reports the new path, not the old one', async () => {
		const { cwd } = setupChangedRepo({ rename: { from: 'src/index.js', to: 'src/renamed.js' } });

		const changed = await readGitChangedFiles({ cwd });

		expect(changed).toStrictEqual(['src/renamed.js']);
	});

	test('a nested consumer gets paths relative to itself, with the repo prefix stripped', async () => {
		const { cwd } = setupChangedRepo({
			write: { 'apps/api/src/added.ts': 'export const added = 1;\n', 'apps/web/other.ts': 'export const other = 1;\n' },
			at: join('apps', 'api'),
		});

		const changed = await readGitChangedFiles({ cwd });

		// paths line up with what agents report from the consumer root, and a sibling
		// package is out of scope
		expect(changed).toStrictEqual(['src/added.ts']);
	});

	test('a directory outside any worktree reports undefined', async () => {
		const { cwd } = setupChangedRepo({ git: false, write: { 'src/added.ts': 'export const added = 1;\n' } });

		const changed = await readGitChangedFiles({ cwd });

		// no worktree means no git truth — the caller degrades to agent-reported files
		expect(changed).toBe(undefined);
	});
});
