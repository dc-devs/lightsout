import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { WorktreeOwner } from '#src/contracts/index.ts';
import { readWorktreeRecord, writeWorktreeRecord } from '#src/worktree/records/index.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/**
 * A primary checkout with a linked worktree cut from it, standing on a branch
 * whose name carries a slash — the shape an isolated run records itself in, and
 * the one where the record's directory and the caller's `cwd` are two different
 * checkouts.
 */
const setupLinkedWorktree = ({ branch = 'feature/lo-7-isolate', name = 'lo-7-isolate' }: { branch?: string; name?: string } = {}) => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-7-isolate');

	execSync(`git worktree add -q -b ${branch} "${worktree}" main`, { cwd, stdio: 'ignore' });
	seedWorkOrderRecord({ cwd, name, branch });

	return { branch, name, primary: cwd, worktree };
};

/**
 * A checkout whose work order claims the branch, with a directory where the
 * temporary file needs to be — so the write itself cannot land.
 */
const setupBlockedCheckout = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-worktree-record-'));

	seedWorkOrderRecord({ cwd, name: 'lo-7-isolate' });
	mkdirSync(join(cwd, '.lightsout', 'work-orders', 'lo-7-isolate', 'worktree.json.tmp'), { recursive: true });

	return { cwd };
};

/** A checkout outside any repository whose ticket folder already holds another record of the same ticket. */
const setupOccupiedTicketFolder = ({ branch = 'lo-131-occupied' }: { branch?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-worktree-record-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', branch);

	seedWorkOrderRecord({ cwd, name: branch });
	writeFileSync(join(workOrderFolder, 'ship.json'), '{"branch":"lo-131-occupied"}\n');

	return { branch, cwd, workOrderFolder, worktreePath: join(cwd, '..', 'repo-worktrees', branch) };
};

/** A checkout outside any repository where the branch's ownership was already recorded once, by a planning run. */
const setupRecordedOwner = async ({ branch = 'lo-131-rehomed' }: { branch?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-worktree-record-'));
	const worktreePath = join(cwd, '..', 'repo-worktrees', branch);

	seedWorkOrderRecord({ cwd, name: branch });
	await writeWorktreeRecord({ cwd, branch, owner: WorktreeOwner.Plan, worktreePath });

	return { branch, cwd, workOrderFolder: join(cwd, '.lightsout', 'work-orders', branch), worktreePath };
};

/**
 * A checkout outside any repository holding one work order whose record stores
 * a prefixed branch, so the label and the branch are two different strings and
 * only the record can say which folder the branch's records belong in.
 */
const setupPrefixedWorkOrder = ({ name = 'lo-2-beta', branch = 'feature/lo-2-beta' }: { name?: string; branch?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-worktree-record-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', name);

	seedWorkOrderRecord({ cwd, name, branch });

	return { branch, cwd, name, workOrderFolder, worktreePath: join(cwd, '..', 'repo-worktrees', name) };
};

describe('writeWorktreeRecord', () => {
	test("writes a slash-bearing branch into its work order's own folder under the primary checkout", async () => {
		const { branch, primary, worktree } = setupLinkedWorktree();

		await writeWorktreeRecord({ cwd: worktree, branch, owner: WorktreeOwner.Implement, worktreePath: worktree });

		expect(readdirSync(join(primary, '.lightsout', 'work-orders'))).toStrictEqual(['lo-7-isolate']);
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
		const { branch, primary, worktree } = setupLinkedWorktree({ branch: 'lo-131-pinned', name: 'lo-131-pinned' });
		const adoptedBranch = 'lo-131-adopted';
		const startPoint = '0123456789abcdef0123456789abcdef01234567';

		seedWorkOrderRecord({ cwd: primary, name: adoptedBranch });

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

	test("writeWorktreeRecord: writes worktree.json into the branch's work order folder under the primary checkout", async () => {
		const { branch, primary, worktree } = setupLinkedWorktree();

		await writeWorktreeRecord({ cwd: worktree, branch, owner: WorktreeOwner.Implement, worktreePath: worktree });

		expect(readdirSync(join(primary, '.lightsout', 'work-orders', 'lo-7-isolate')).sort()).toStrictEqual(['state.json', 'worktree.json']);
		expect(await readWorktreeRecord({ cwd: worktree, branch })).toEqual(
			expect.objectContaining({ branch: 'feature/lo-7-isolate', owner: 'implement', worktreePath: worktree }),
		);
	});

	test("files the record beside the ticket's other records rather than over the folder", async () => {
		const { branch, cwd, workOrderFolder, worktreePath } = setupOccupiedTicketFolder();

		await writeWorktreeRecord({ cwd, branch, owner: WorktreeOwner.Implement, worktreePath });

		expect(readdirSync(workOrderFolder).sort()).toStrictEqual(['ship.json', 'state.json', 'worktree.json']);
		expect(readFileSync(join(workOrderFolder, 'ship.json'), 'utf8')).toBe('{"branch":"lo-131-occupied"}\n');
	});

	test('re-stamps an owner a second write names, leaving no temporary file behind', async () => {
		const { branch, cwd, workOrderFolder, worktreePath } = await setupRecordedOwner();

		await writeWorktreeRecord({ cwd, branch, owner: WorktreeOwner.Implement, worktreePath });

		expect(readdirSync(workOrderFolder).sort()).toStrictEqual(['state.json', 'worktree.json']);
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

	test("records a prefixed branch's ownership in the work order's own folder", async () => {
		const { branch, cwd, workOrderFolder, worktreePath } = setupPrefixedWorkOrder();

		await writeWorktreeRecord({ cwd, branch, owner: WorktreeOwner.Implement, worktreePath });

		expect(readdirSync(join(cwd, '.lightsout', 'work-orders'))).toStrictEqual(['lo-2-beta']);
		expect(readdirSync(workOrderFolder).sort()).toStrictEqual(['state.json', 'worktree.json']);
		expect(await readWorktreeRecord({ cwd, branch })).toEqual(expect.objectContaining({ branch: 'feature/lo-2-beta', owner: 'implement', worktreePath }));
	});
});
