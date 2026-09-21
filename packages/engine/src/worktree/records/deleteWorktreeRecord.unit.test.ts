import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { WorktreeOwner } from '#src/contracts/index.ts';
import { deleteWorktreeRecord, readWorktreeRecord, writeWorktreeRecord } from '#src/worktree/records/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** A checkout outside any repository, carrying one written record for the branch under test. */
const setupRecordedBranch = async ({ branch = 'lo-70-drain' }: { branch?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-worktree-record-'));
	const recordPath = join(cwd, '.lightsout', 'tickets', branch, 'worktree.json');

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
	const ticketFolder = join(cwd, '.lightsout', 'tickets', branch);

	await writeWorktreeRecord({ cwd, branch, owner: WorktreeOwner.Implement, worktreePath: join(cwd, '..', 'repo-worktrees', branch) });

	// The writer reports a refused write rather than throwing, so a missing file
	// here would leave the deletion under test with nothing to remove.
	if (!existsSync(join(ticketFolder, 'worktree.json'))) {
		throw new Error(`the record for ${branch} was never written, so this test would prove nothing`);
	}

	writeFileSync(join(ticketFolder, 'ticket.json'), `{"branch":"${branch}"}\n`);

	return { branch, cwd, ticketFolder };
};

/**
 * A primary checkout holding the record for a branch, with the linked worktree
 * that record describes cut from it — the checkout a run stands in when it
 * forgets its own tree.
 */
const setupLinkedWorktreeRecord = async ({ branch = 'feature/lo-70-drain' }: { branch?: string } = {}) => {
	const { cwd: primary } = setupBranchRepo();
	const worktree = join(primary, '.worktrees', 'lo-70-drain');
	const recordPath = join(primary, '.lightsout', 'tickets', 'feature-lo-70-drain', 'worktree.json');

	execSync(`git worktree add -q -b ${branch} "${worktree}" main`, { cwd: primary, stdio: 'ignore' });
	await writeWorktreeRecord({ cwd: primary, branch, owner: WorktreeOwner.Implement, worktreePath: worktree });

	// The writer reports a refused write rather than throwing, so a missing file
	// here would leave the deletion under test with nothing to remove.
	if (!existsSync(recordPath)) {
		throw new Error(`the record for ${branch} was never written, so this test would prove nothing`);
	}

	return { branch, primary, recordPath, worktree };
};

describe('deleteWorktreeRecord', () => {
	test('removes the record and tolerates a record that is already gone', async () => {
		const { branch, cwd, recordPath } = await setupRecordedBranch();

		await deleteWorktreeRecord({ cwd, branch });

		expect(existsSync(recordPath)).toBe(false);
		expect(await readWorktreeRecord({ cwd, branch })).toBe(undefined);
		await expect(deleteWorktreeRecord({ cwd, branch })).resolves.toBe(undefined);
	});

	test("deleteWorktreeRecord: removes worktree.json and leaves the ticket's other records standing", async () => {
		const { branch, cwd, ticketFolder } = await setupTicketFolderRecords();

		await deleteWorktreeRecord({ cwd, branch });

		expect(readdirSync(ticketFolder)).toStrictEqual(['ticket.json']);
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
});
