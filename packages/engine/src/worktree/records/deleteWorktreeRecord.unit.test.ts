import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { WorktreeOwner } from '#src/contracts/worktree/WorktreeOwner.ts';
import { deleteWorktreeRecord } from '#src/worktree/records/deleteWorktreeRecord.ts';
import { readWorktreeRecord } from '#src/worktree/records/readWorktreeRecord.ts';
import { writeWorktreeRecord } from '#src/worktree/records/writeWorktreeRecord.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** A checkout outside any repository, carrying one written record for the branch under test. */
const setupRecordedBranch = async ({ branch = 'lo-70-drain' }: { branch?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-worktree-record-'));
	const recordPath = join(cwd, '.lightsout', 'work-orders', branch, 'worktree.json');

	seedWorkOrderRecord({ cwd, name: branch });

	await writeWorktreeRecord({ cwd, branch, owner: WorktreeOwner.Implement, worktreePath: join(cwd, '..', 'repo-worktrees', branch) });

	// The writer reports a refused write rather than throwing, so a missing file
	// here would leave the deletion under test with nothing to remove.
	if (!existsSync(recordPath)) {
		throw new Error(`the record for ${branch} was never written, so this test would prove nothing`);
	}

	return { branch, cwd, recordPath };
};

/**
 * A checkout outside any repository whose ticket folder holds the branch's
 * worktree record beside another record of the same ticket.
 */
const setupTicketFolderRecords = async ({ branch = 'lo-70-drain' }: { branch?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-worktree-record-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', branch);

	seedWorkOrderRecord({ cwd, name: branch });
	await writeWorktreeRecord({ cwd, branch, owner: WorktreeOwner.Implement, worktreePath: join(cwd, '..', 'repo-worktrees', branch) });

	// The writer reports a refused write rather than throwing, so a missing file
	// here would leave the deletion under test with nothing to remove.
	if (!existsSync(join(workOrderFolder, 'worktree.json'))) {
		throw new Error(`the record for ${branch} was never written, so this test would prove nothing`);
	}

	return { branch, cwd, workOrderFolder };
};

/**
 * A primary checkout holding the record for a branch, with the linked worktree
 * that record describes cut from it — the checkout a run stands in when it
 * forgets its own tree.
 */
const setupLinkedWorktreeRecord = async ({ branch = 'feature/lo-70-drain' }: { branch?: string } = {}) => {
	const { cwd: primary } = setupBranchRepo();
	const worktree = join(primary, '.worktrees', 'lo-70-drain');
	const recordPath = join(primary, '.lightsout', 'work-orders', 'lo-70-drain', 'worktree.json');

	execSync(`git worktree add -q -b ${branch} "${worktree}" main`, { cwd: primary, stdio: 'ignore' });
	seedWorkOrderRecord({ cwd: primary, name: 'lo-70-drain', branch });
	await writeWorktreeRecord({ cwd: primary, branch, owner: WorktreeOwner.Implement, worktreePath: worktree });

	// The writer reports a refused write rather than throwing, so a missing file
	// here would leave the deletion under test with nothing to remove.
	if (!existsSync(recordPath)) {
		throw new Error(`the record for ${branch} was never written, so this test would prove nothing`);
	}

	return { branch, primary, recordPath, worktree };
};

/**
 * A checkout outside any repository whose work-orders directory holds a record
 * for one branch and no record at all for the branch under test, standing
 * beside the folder the old branch-slugging rule would have filed that branch's
 * worktree record in.
 */
const setupUnclaimedBranch = ({ branch = 'feature/lo-70-drain' }: { branch?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-worktree-record-'));
	const claimedFolder = join(cwd, '.lightsout', 'work-orders', 'lo-71-ship');
	const sluggedFolder = join(cwd, '.lightsout', 'work-orders', 'feature-lo-70-drain');
	const claimedRecordPath = join(claimedFolder, 'worktree.json');
	const sluggedRecordPath = join(sluggedFolder, 'worktree.json');

	seedWorkOrderRecord({ cwd, name: 'lo-71-ship' });
	writeFileSync(claimedRecordPath, '{"owner":"implement"}\n');

	// A leftover of the slugging rule this phase deletes: a folder named after the
	// branch rather than after a work order, which no record claims.
	mkdirSync(sluggedFolder, { recursive: true });
	writeFileSync(sluggedRecordPath, '{"owner":"implement"}\n');

	return { branch, claimedRecordPath, cwd, sluggedRecordPath };
};

describe('deleteWorktreeRecord', () => {
	test('removes the record and tolerates a record that is already gone', async () => {
		const { branch, cwd, recordPath } = await setupRecordedBranch();

		await deleteWorktreeRecord({ cwd, branch });

		expect(existsSync(recordPath)).toBe(false);
		expect(await readWorktreeRecord({ cwd, branch })).toBe(undefined);
		await expect(deleteWorktreeRecord({ cwd, branch })).resolves.toBe(undefined);
	});

	test("deleteWorktreeRecord: removes worktree.json and leaves the work order's other records standing", async () => {
		const { branch, cwd, workOrderFolder } = await setupTicketFolderRecords();

		await deleteWorktreeRecord({ cwd, branch });

		expect(readdirSync(workOrderFolder)).toStrictEqual(['state.json']);
		expect(await readWorktreeRecord({ cwd, branch })).toBe(undefined);
	});

	test("removes the primary checkout's record when asked from the linked worktree it describes", async () => {
		const { branch, recordPath, worktree } = await setupLinkedWorktreeRecord();

		await deleteWorktreeRecord({ cwd: worktree, branch });

		expect(existsSync(recordPath)).toBe(false);
		expect(await readWorktreeRecord({ cwd: worktree, branch })).toBe(undefined);
		// nothing was written into the tree itself, so the removal cannot have gone there
		expect(existsSync(join(worktree, '.lightsout'))).toBe(false);
	});

	test('tolerates a branch that keeps no record', async () => {
		const { branch, claimedRecordPath, cwd, sluggedRecordPath } = setupUnclaimedBranch();

		const removal = deleteWorktreeRecord({ cwd, branch });

		await expect(removal).resolves.toBe(undefined);
		expect(existsSync(sluggedRecordPath)).toBe(true);
		expect(existsSync(claimedRecordPath)).toBe(true);
	});
});
