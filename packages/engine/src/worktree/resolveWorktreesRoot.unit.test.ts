import { execSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resolveWorktreesRoot } from '#src/worktree/resolveWorktreesRoot.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/**
 * A primary checkout with a linked worktree added from it — the shape a second
 * launch takes when the user is already standing in a worktree of their own.
 */
const setupLinkedWorktree = () => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-131-isolated-implement');

	execSync(`git worktree add -q -b lo-131-isolated-implement "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { primary: cwd, worktree };
};

/** A directory with no repository above it, so git can answer nothing. */
const setupLooseDirectory = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-worktrees-root-'));

	return { cwd };
};

describe('resolveWorktreesRoot', () => {
	test("answers the primary checkout's sibling root when called from a linked worktree, never a root nested beside it", async () => {
		const { primary, worktree } = setupLinkedWorktree();

		const worktreesRoot = await resolveWorktreesRoot({ cwd: worktree });

		expect({
			parent: realpathSync(dirname(worktreesRoot)),
			name: basename(worktreesRoot),
			sitsInsideTheLinkedTree: worktreesRoot.startsWith(worktree),
		}).toStrictEqual({
			parent: realpathSync(dirname(primary)),
			name: `${basename(primary)}-worktrees`,
			sitsInsideTheLinkedTree: false,
		});
	});

	test("falls back to the given directory's sibling root when no repository resolves", async () => {
		const { cwd } = setupLooseDirectory();

		const worktreesRoot = await resolveWorktreesRoot({ cwd });

		expect(worktreesRoot).toBe(`${cwd}-worktrees`);
	});

	test('answers a sibling of the repo, never a directory inside it — a nested worktree confuses anything that walks up for a repo root', async () => {
		expect(await resolveWorktreesRoot({ cwd: '/work/acme' })).toBe('/work/acme-worktrees');
	});

	test('resolves a relative cwd first, so the answer never carries a `..` segment', async () => {
		const root = await resolveWorktreesRoot({ cwd: '.' });

		expect(root.includes('..')).toBe(false);
		expect(root.endsWith('-worktrees')).toBe(true);
	});

	test('ignores a trailing separator, so `/work/acme/` and `/work/acme` name one directory', async () => {
		expect(await resolveWorktreesRoot({ cwd: '/work/acme/' })).toBe(await resolveWorktreesRoot({ cwd: '/work/acme' }));
	});
});
