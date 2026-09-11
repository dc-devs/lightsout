import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { WorktreeOwner } from '#src/contracts/index.ts';
import { settleReconciledWorktree } from '#src/queue/common/utils/settleReconciledWorktree.ts';
import { createWorktree, readWorktreeRecord } from '#src/worktree/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** A main checkout with one real worktree on a ticket branch, cut from the default branch. */
const setupWorktree = async ({ branch }: { branch: string }) => {
	const { cwd } = setupBranchRepo();

	execSync('git config user.name t && git config user.email t@t', { cwd, stdio: 'ignore' });

	const worktreePath = String(await createWorktree({ cwd, branch, startPoint: 'origin/main', owner: WorktreeOwner.Queue, reuseExisting: true }));

	return { cwd, worktreePath };
};

/**
 * Whether git still knows the branch. Asserted instead of the worktree list
 * because git prints filesystem-resolved paths, and a temp directory behind a
 * symlink would make a path comparison lie.
 */
const branchExists = ({ cwd, branch }: { cwd: string; branch: string }) => execSync(`git branch --list ${branch}`, { cwd }).toString().trim() !== '';

describe('settleReconciledWorktree', () => {
	test('removes a clean worktree and answers nothing, so a later drain does not rediscover shipped work', async () => {
		const { cwd, worktreePath } = await setupWorktree({ branch: 'lo-70-drain' });

		expect(await settleReconciledWorktree({ cwd, worktreePath, branch: 'lo-70-drain' })).toBe(undefined);
		expect(existsSync(worktreePath)).toBe(false);
		expect(branchExists({ cwd, branch: 'lo-70-drain' })).toBe(false);
	});

	test('keeps a worktree with uncommitted changes and names it, because a merge says nothing about work begun since', async () => {
		const { cwd, worktreePath } = await setupWorktree({ branch: 'lo-70-drain' });
		const progress: string[] = [];

		writeFileSync(join(worktreePath, 'half-done.ts'), 'export const value = 1;\n');

		const held = await settleReconciledWorktree({ cwd, worktreePath, branch: 'lo-70-drain', onProgress: (message) => progress.push(message) });

		expect(held).toBe(` — the worktree at ${worktreePath} was left in place because it has uncommitted changes`);
		expect(progress).toEqual([`the worktree at ${worktreePath} has uncommitted changes, so it was left in place`]);
		expect(existsSync(worktreePath)).toBe(true);
		expect(branchExists({ cwd, branch: 'lo-70-drain' })).toBe(true);
	});

	test('answers nothing and removes nothing for a path git cannot read at all', async () => {
		const { cwd, worktreePath } = await setupWorktree({ branch: 'lo-70-drain' });

		expect(await settleReconciledWorktree({ cwd, worktreePath: join(cwd, 'no-such-worktree'), branch: 'lo-70-drain' })).toBe(undefined);
		// Nothing was read, so nothing was decided — the real tree stands.
		expect(existsSync(worktreePath)).toBe(true);
		expect(branchExists({ cwd, branch: 'lo-70-drain' })).toBe(true);
	});

	test('removes a clean tree and its record, and keeps a dirty tree and its record', async () => {
		const clean = await setupWorktree({ branch: 'lo-70-clean' });
		const dirty = await setupWorktree({ branch: 'lo-70-dirty' });

		writeFileSync(join(dirty.worktreePath, 'half-done.ts'), 'export const value = 1;\n');

		const cleanHeld = await settleReconciledWorktree({ cwd: clean.cwd, worktreePath: clean.worktreePath, branch: 'lo-70-clean' });
		const dirtyHeld = await settleReconciledWorktree({ cwd: dirty.cwd, worktreePath: dirty.worktreePath, branch: 'lo-70-dirty' });

		expect(cleanHeld).toBe(undefined);
		expect(existsSync(clean.worktreePath)).toBe(false);
		expect(await readWorktreeRecord({ cwd: clean.cwd, branch: 'lo-70-clean' })).toBe(undefined);
		expect(dirtyHeld).toBe(` — the worktree at ${dirty.worktreePath} was left in place because it has uncommitted changes`);
		expect(existsSync(dirty.worktreePath)).toBe(true);
		expect(await readWorktreeRecord({ cwd: dirty.cwd, branch: 'lo-70-dirty' })).toEqual(
			expect.objectContaining({ branch: 'lo-70-dirty', owner: 'queue', worktreePath: dirty.worktreePath }),
		);
	});
});
