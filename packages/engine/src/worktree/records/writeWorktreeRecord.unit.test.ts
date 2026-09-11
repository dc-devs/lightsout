import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { WorktreeOwner } from '#src/contracts/index.ts';
import { readWorktreeRecord, writeWorktreeRecord } from '#src/worktree/records/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/**
 * A primary checkout with a linked worktree cut from it, standing on a branch
 * whose name carries a slash — the shape an isolated run records itself in, and
 * the one where the record's directory and the caller's `cwd` are two different
 * checkouts.
 */
const setupLinkedWorktree = ({ branch = 'feature/lo-7-isolate' }: { branch?: string } = {}) => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-7-isolate');

	execSync(`git worktree add -q -b ${branch} "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { branch, primary: cwd, worktree };
};

/** A directory outside any repository with a plain file where the record directory needs to be, so the write cannot land. */
const setupBlockedCheckout = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-worktree-record-'));

	writeFileSync(join(cwd, '.lightsout'), 'not a directory\n');

	return { cwd };
};

describe('writeWorktreeRecord', () => {
	test('writes a slash-bearing branch to one flat file under the primary checkout', async () => {
		const { branch, primary, worktree } = setupLinkedWorktree();

		await writeWorktreeRecord({ cwd: worktree, branch, owner: WorktreeOwner.Implement, worktreePath: worktree });

		expect(readdirSync(join(primary, '.lightsout', 'worktrees'))).toStrictEqual(['feature-lo-7-isolate.json']);
		expect(existsSync(join(worktree, '.lightsout'))).toBe(false);
		expect(await readWorktreeRecord({ cwd: worktree, branch })).toEqual(
			expect.objectContaining({ branch: 'feature/lo-7-isolate', owner: 'implement', worktreePath: worktree }),
		);
	});

	test('reports an unwritable record as a progress line instead of throwing', async () => {
		const { cwd } = setupBlockedCheckout();
		const progress: string[] = [];

		await expect(
			writeWorktreeRecord({
				cwd,
				branch: 'lo-7-isolate',
				owner: WorktreeOwner.Implement,
				worktreePath: join(cwd, '..', 'repo-worktrees', 'lo-7-isolate'),
				onProgress: (message) => progress.push(message),
			}),
		).resolves.toBe(undefined);

		expect(progress).toEqual([expect.stringContaining('lo-7-isolate')]);
	});

	test('keeps the start point a tree was cut from, and stays absent when none was given', async () => {
		const { branch, primary, worktree } = setupLinkedWorktree({ branch: 'lo-131-pinned' });
		const adoptedBranch = 'lo-131-adopted';
		const startPoint = '0123456789abcdef0123456789abcdef01234567';

		await Promise.all([
			writeWorktreeRecord({ cwd: primary, branch, owner: WorktreeOwner.Plan, worktreePath: worktree, startPoint }),
			writeWorktreeRecord({ cwd: primary, branch: adoptedBranch, owner: WorktreeOwner.Plan, worktreePath: worktree }),
		]);

		expect(await readWorktreeRecord({ cwd: worktree, branch })).toEqual(
			expect.objectContaining({ branch: 'lo-131-pinned', startPoint: '0123456789abcdef0123456789abcdef01234567' }),
		);
		const adopted = await readWorktreeRecord({ cwd: worktree, branch: adoptedBranch });

		expect(adopted?.createdAt).toEqual(expect.any(String));
		expect(adopted).toStrictEqual({
			branch: 'lo-131-adopted',
			owner: 'plan',
			worktreePath: worktree,
			createdAt: adopted?.createdAt,
		});
	});
});
