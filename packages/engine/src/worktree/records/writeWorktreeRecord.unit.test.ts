import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** A checkout outside any repository whose ticket folder already holds another record of the same ticket. */
const setupOccupiedTicketFolder = ({ branch = 'lo-131-occupied' }: { branch?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-worktree-record-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', branch);

	mkdirSync(workOrderFolder, { recursive: true });
	writeFileSync(join(workOrderFolder, 'ship.json'), '{"branch":"lo-131-occupied"}\n');

	return { branch, cwd, workOrderFolder, worktreePath: join(cwd, '..', 'repo-worktrees', branch) };
};

/** A checkout outside any repository where the branch's ownership was already recorded once, by a planning run. */
const setupRecordedOwner = async ({ branch = 'lo-131-rehomed' }: { branch?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-worktree-record-'));
	const worktreePath = join(cwd, '..', 'repo-worktrees', branch);

	await writeWorktreeRecord({ cwd, branch, owner: WorktreeOwner.Plan, worktreePath });

	return { branch, cwd, workOrderFolder: join(cwd, '.lightsout', 'work-orders', branch), worktreePath };
};

describe('writeWorktreeRecord', () => {
	test('writes a slash-bearing branch to one flat ticket folder under the primary checkout', async () => {
		const { branch, primary, worktree } = setupLinkedWorktree();

		await writeWorktreeRecord({ cwd: worktree, branch, owner: WorktreeOwner.Implement, worktreePath: worktree });

		expect(readdirSync(join(primary, '.lightsout', 'work-orders'))).toStrictEqual(['feature-lo-7-isolate']);
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

	test("writeWorktreeRecord: writes worktree.json into the branch's ticket folder under the primary checkout", async () => {
		const { branch, primary, worktree } = setupLinkedWorktree();

		await writeWorktreeRecord({ cwd: worktree, branch, owner: WorktreeOwner.Implement, worktreePath: worktree });

		expect(readdirSync(join(primary, '.lightsout', 'work-orders', 'feature-lo-7-isolate'))).toStrictEqual(['worktree.json']);
		expect(await readWorktreeRecord({ cwd: worktree, branch })).toEqual(
			expect.objectContaining({ branch: 'feature/lo-7-isolate', owner: 'implement', worktreePath: worktree }),
		);
	});

	test("files the record beside the ticket's other records rather than over the folder", async () => {
		const { branch, cwd, workOrderFolder, worktreePath } = setupOccupiedTicketFolder();

		await writeWorktreeRecord({ cwd, branch, owner: WorktreeOwner.Implement, worktreePath });

		expect(readdirSync(workOrderFolder).sort()).toStrictEqual(['ship.json', 'worktree.json']);
		expect(readFileSync(join(workOrderFolder, 'ship.json'), 'utf8')).toBe('{"branch":"lo-131-occupied"}\n');
	});

	test('re-stamps an owner a second write names, leaving no temporary file behind', async () => {
		const { branch, cwd, workOrderFolder, worktreePath } = await setupRecordedOwner();

		await writeWorktreeRecord({ cwd, branch, owner: WorktreeOwner.Implement, worktreePath });

		expect(readdirSync(workOrderFolder)).toStrictEqual(['worktree.json']);
		expect(await readWorktreeRecord({ cwd, branch })).toEqual(expect.objectContaining({ branch: 'lo-131-rehomed', owner: 'implement', worktreePath }));
	});

	test('swallows a refused write when no progress listener was given, recording nothing', async () => {
		const { cwd } = setupBlockedCheckout();

		await expect(
			writeWorktreeRecord({
				cwd,
				branch: 'lo-7-isolate',
				owner: WorktreeOwner.Implement,
				worktreePath: join(cwd, '..', 'repo-worktrees', 'lo-7-isolate'),
			}),
		).resolves.toBe(undefined);

		expect(await readWorktreeRecord({ cwd, branch: 'lo-7-isolate' })).toBe(undefined);
	});
});
