import { execFileSync } from 'node:child_process';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readGitWorkingChanges } from '#src/common/git/readGitWorkingChanges.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/**
 * A committed consumer repo plus working-tree edits. `sources` are committed
 * with the repo; `write` plants files by repo-root-relative path afterwards
 * (overwriting a committed one makes it modified, a new one makes it
 * untracked), `remove` deletes committed files from disk without staging,
 * `move` stages a `git mv`, `createdAndDeleted` stages a new file and then
 * deletes it from disk (git's `AD`), and `at` anchors the read at a subdirectory — the
 * nested-consumer case where git's repo-root-relative paths need the prefix
 * stripped.
 */
const setupWorkingRepo = ({
	git = true,
	sources,
	write = {},
	remove = [],
	move,
	createdAndDeleted = [],
	at,
}: {
	git?: boolean;
	sources?: Record<string, string>;
	write?: Record<string, string>;
	remove?: string[];
	move?: { from: string; to: string };
	createdAndDeleted?: string[];
	at?: string;
} = {}) => {
	const root = setupConsumerRepo({ git, sources });

	for (const [path, content] of Object.entries(write)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}

	for (const path of remove) {
		unlinkSync(join(root, path));
	}

	if (move) {
		execFileSync('git', ['mv', move.from, move.to], { cwd: root });
	}

	for (const path of createdAndDeleted) {
		writeFileSync(join(root, path), 'export const transient = 1;\n');
		execFileSync('git', ['add', path], { cwd: root });
		unlinkSync(join(root, path));
	}

	return { cwd: at ? join(root, at) : root };
};

/**
 * Two directories side by side: one outside any worktree, and a consumer
 * nested at `apps/api` inside a larger repo, with an untracked file, a deleted
 * committed file and a sibling package's edit.
 */
const setupOutsideAndNested = () => {
	const outside = setupWorkingRepo({ git: false, write: { 'src/added.ts': 'export const added = 1;\n' } });
	const nested = setupWorkingRepo({
		sources: { 'src/index.js': 'export const one = 1;\n', 'apps/api/src/old.js': 'export const old = 1;\n' },
		write: { 'apps/api/src/added.ts': 'export const added = 1;\n', 'apps/web/other.ts': 'export const other = 1;\n' },
		remove: ['apps/api/src/old.js'],
		at: join('apps', 'api'),
	});

	return { outsideCwd: outside.cwd, nestedCwd: nested.cwd };
};

const byPath = (changes: { path: string; kind: string }[] | undefined) => [...(changes ?? [])].sort((a, b) => a.path.localeCompare(b.path));

test('readGitWorkingChanges: reports a move as a removal and an addition, beside modified, added and removed files', async () => {
	const { cwd } = setupWorkingRepo({
		sources: { 'src/index.js': 'export const one = 1;\n', 'src/runOne.js': "console.log('one');\n" },
		write: {
			'src/index.js': 'export const one = 2;\n',
			'src/added.ts': 'export const added = 1;\n',
			'.lightsout/runs/r1/manifest.json': '{}\n',
		},
		remove: ['plan.md'],
		move: { from: 'src/runOne.js', to: 'src/moved.js' },
	});

	const changes = await readGitWorkingChanges({ cwd });

	// the staged move is its old path removed and its new path added — never
	// `old -> new` — and the engine's own run state is never reported
	expect(byPath(changes)).toStrictEqual([
		{ path: 'plan.md', kind: 'removed' },
		{ path: 'src/added.ts', kind: 'added' },
		{ path: 'src/index.js', kind: 'modified' },
		{ path: 'src/moved.js', kind: 'added' },
		{ path: 'src/runOne.js', kind: 'removed' },
	]);
});

test('readGitWorkingChanges: is undefined outside a worktree and strips a nested consumer prefix', async () => {
	const { outsideCwd, nestedCwd } = setupOutsideAndNested();

	const [outside, nested] = await Promise.all([readGitWorkingChanges({ cwd: outsideCwd }), readGitWorkingChanges({ cwd: nestedCwd })]);

	// no worktree means no git truth; inside one, paths are relative to the
	// consumer and a sibling package is out of scope
	expect({ outside, nested: byPath(nested) }).toStrictEqual({
		outside: undefined,
		nested: [
			{ path: 'src/added.ts', kind: 'added' },
			{ path: 'src/old.js', kind: 'removed' },
		],
	});
});

test('readGitWorkingChanges: reads a file added and then deleted within the run as removed, never as a file on disk', async () => {
	const { cwd } = setupWorkingRepo({ createdAndDeleted: ['src/scratch.ts'] });

	const changes = await readGitWorkingChanges({ cwd });

	// git reports it `AD`; the deletion wins, so no caller tries to read it from disk
	expect(changes).toStrictEqual([{ path: 'src/scratch.ts', kind: 'removed' }]);
});
