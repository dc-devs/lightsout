import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { WorktreeOwner } from '#src/contracts/index.ts';
import { readWorktreeRecord, writeWorktreeRecord } from '#src/worktree/records/index.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/**
 * A checkout holding one work order per branch named, plus hand-written record
 * files beside them for the off-contract cases the writer would never produce.
 *
 * Every branch gets a work order whose label is the branch, because a branch no
 * record claims keeps no local record at all — which the acceptance case below
 * is about, and these cases are not.
 */
const setupCheckout = ({ files = {}, branches = [] }: { files?: Record<string, string>; branches?: string[] } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-worktree-record-'));

	for (const branch of [...branches, ...Object.keys(files)]) {
		seedWorkOrderRecord({ cwd, name: branch });
	}

	for (const [branch, contents] of Object.entries(files)) {
		writeFileSync(join(cwd, '.lightsout', 'work-orders', branch, 'worktree.json'), contents);
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
	const workOrderFolder = join(primary, '.lightsout', 'work-orders', 'lo-7-isolate');

	execSync(`git worktree add -q -b ${branch} "${worktree}" main`, { cwd: primary, stdio: 'ignore' });
	seedWorkOrderRecord({ cwd: primary, name: 'lo-7-isolate', branch });
	writeFileSync(
		join(workOrderFolder, 'worktree.json'),
		JSON.stringify({ branch, owner: WorktreeOwner.Implement, worktreePath: worktree, createdAt: '2026-01-01T00:00:00.000Z', startPoint: 'main' }),
	);

	return { branch, primary, worktree };
};

/**
 * A checkout whose work-orders directory holds a record for one other branch,
 * with an ownership write already attempted for a branch no record claims —
 * the arrangement that makes "nothing was written for it" the read's own
 * starting point.
 */
const setupUnclaimedBranch = async ({ branch = 'lo-8-unclaimed' }: { branch?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-worktree-record-'));
	const claimedFolder = join(cwd, '.lightsout', 'work-orders', 'lo-8-claimed');
	const progress: string[] = [];

	seedWorkOrderRecord({ cwd, name: 'lo-8-claimed' });

	await writeWorktreeRecord({
		cwd,
		branch,
		owner: WorktreeOwner.Implement,
		worktreePath: join(cwd, '..', 'repo-worktrees', branch),
		onProgress: (message) => progress.push(message),
	});

	return { branch, claimedFolder, cwd, progress };
};

describe('readWorktreeRecord', () => {
	test('answers undefined for a branch that keeps no record', async () => {
		const { branch, claimedFolder, cwd, progress } = await setupUnclaimedBranch();

		const record = await readWorktreeRecord({ cwd, branch });

		expect(record).toBe(undefined);
		expect(readdirSync(join(cwd, '.lightsout', 'work-orders'))).toStrictEqual(['lo-8-claimed']);
		expect(readdirSync(claimedFolder)).toStrictEqual(['state.json']);
		expect(progress).toEqual([expect.stringContaining('lo-8-unclaimed')]);
	});

	test('reads back a written record, and answers undefined for a missing or malformed one', async () => {
		const { cwd } = setupCheckout({
			branches: ['lo-7-isolate'],
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
