import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { WorktreeOwner } from '#src/contracts/index.ts';
import { readWorktreeRecord, writeWorktreeRecord } from '#src/worktree/records/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** An empty checkout, plus hand-written record files by branch for the off-contract cases the writer would never produce. */
const setupCheckout = ({ files = {} }: { files?: Record<string, string> } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-worktree-record-'));

	for (const [branch, contents] of Object.entries(files)) {
		mkdirSync(join(cwd, '.lightsout', 'tickets', branch), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'tickets', branch, 'worktree.json'), contents);
	}

	return { cwd };
};

/**
 * A primary checkout holding one branch's record, with a linked worktree cut
 * from it standing on that branch and no state directory of its own — the shape
 * an isolated run asks about its own tree from.
 */
const setupLinkedWorktreeRecord = ({ branch = 'feature/lo-7-isolate' }: { branch?: string } = {}) => {
	const { cwd: primary } = setupBranchRepo();
	const worktree = join(primary, '.worktrees', 'lo-7-isolate');
	const ticketFolder = join(primary, '.lightsout', 'tickets', 'feature-lo-7-isolate');

	execSync(`git worktree add -q -b ${branch} "${worktree}" main`, { cwd: primary, stdio: 'ignore' });
	mkdirSync(ticketFolder, { recursive: true });
	writeFileSync(
		join(ticketFolder, 'worktree.json'),
		JSON.stringify({ branch, owner: WorktreeOwner.Implement, worktreePath: worktree, createdAt: '2026-01-01T00:00:00.000Z', startPoint: 'main' }),
	);

	return { branch, primary, worktree };
};

describe('readWorktreeRecord', () => {
	test('reads back a written record, and answers undefined for a missing or malformed one', async () => {
		const { cwd } = setupCheckout({
			files: {
				'lo-7-malformed': '{ this is not json',
				// Valid JSON that the contract still refuses: an owner neither member
				// of `WorktreeOwner` holds, which is what an older or newer engine
				// could have written.
				'lo-7-off-contract': JSON.stringify({
					branch: 'lo-7-off-contract',
					owner: 'refactor',
					worktreePath: '/tmp/lightsout-worktrees/lo-7-off-contract',
					createdAt: '2026-01-01T00:00:00.000Z',
				}),
			},
		});

		await writeWorktreeRecord({
			cwd,
			branch: 'lo-7-isolate',
			owner: WorktreeOwner.Implement,
			worktreePath: '/tmp/lightsout-worktrees/lo-7-isolate',
		});

		expect(await readWorktreeRecord({ cwd, branch: 'lo-7-isolate' })).toEqual(
			expect.objectContaining({
				branch: 'lo-7-isolate',
				owner: 'implement',
				worktreePath: '/tmp/lightsout-worktrees/lo-7-isolate',
			}),
		);
		expect(await readWorktreeRecord({ cwd, branch: 'lo-7-unrecorded' })).toBe(undefined);
		expect(await readWorktreeRecord({ cwd, branch: 'lo-7-malformed' })).toBe(undefined);
		expect(await readWorktreeRecord({ cwd, branch: 'lo-7-off-contract' })).toBe(undefined);
	});

	test("reads the primary checkout's record when asked from a linked worktree", async () => {
		const { branch, worktree } = setupLinkedWorktreeRecord();

		const record = await readWorktreeRecord({ cwd: worktree, branch });

		expect(record).toStrictEqual({
			branch: 'feature/lo-7-isolate',
			owner: 'implement',
			worktreePath: worktree,
			createdAt: '2026-01-01T00:00:00.000Z',
			startPoint: 'main',
		});
		// the tree keeps no state directory of its own, so a read scoped to it could only answer undefined
		expect(existsSync(join(worktree, '.lightsout'))).toBe(false);
	});
});
