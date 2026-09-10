import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { WorktreeOwner } from '#src/contracts/index.ts';
import { deleteWorktreeRecord, readWorktreeRecord, writeWorktreeRecord } from '#src/worktree/records/index.ts';

/** A checkout outside any repository, carrying one written record for the branch under test. */
const setupRecordedBranch = async ({ branch = 'lo-70-drain' }: { branch?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-worktree-record-'));
	const recordPath = join(cwd, '.lightsout', 'worktrees', `${branch}.json`);

	await writeWorktreeRecord({ cwd, branch, owner: WorktreeOwner.Implement, worktreePath: join(cwd, '..', 'repo-worktrees', branch) });

	// The writer reports a refused write rather than throwing, so a missing file
	// here would leave the deletion under test with nothing to remove.
	if (!existsSync(recordPath)) {
		throw new Error(`the record for ${branch} was never written, so this test would prove nothing`);
	}

	return { branch, cwd, recordPath };
};

describe('deleteWorktreeRecord', () => {
	test('removes the record and tolerates a record that is already gone', async () => {
		const { branch, cwd, recordPath } = await setupRecordedBranch();

		await deleteWorktreeRecord({ cwd, branch });

		expect(existsSync(recordPath)).toBe(false);
		expect(await readWorktreeRecord({ cwd, branch })).toBe(undefined);
		await expect(deleteWorktreeRecord({ cwd, branch })).resolves.toBe(undefined);
	});
});
