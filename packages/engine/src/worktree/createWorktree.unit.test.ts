import { execSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { WorktreeOwner } from '#src/contracts/index.ts';
import { createWorktree, readWorktreeRecord, removeWorktree, resolveWorktreesRoot, writeWorktreeRecord } from '#src/worktree/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** The repo a run starts from: fetched once already, standing on the default branch. */
const setupMainCheckout = async () => {
	const { cwd } = setupBranchRepo();

	execSync('git config user.name t && git config user.email t@t', { cwd, stdio: 'ignore' });

	return { cwd, worktreesRoot: await resolveWorktreesRoot({ cwd }) };
};

/** A checkout with a directory already sitting where the branch's worktree would go, optionally claimed by an owner. */
const setupOccupiedPath = async ({ branch, owner }: { branch: string; owner?: WorktreeOwner }) => {
	const { cwd, worktreesRoot } = await setupMainCheckout();
	const worktreePath = join(worktreesRoot, branch);

	await mkdir(worktreePath, { recursive: true });

	if (owner !== undefined) {
		await writeWorktreeRecord({ cwd, branch, owner, worktreePath });
	}

	return { cwd, worktreePath };
};

/** Every worktree this test made, cleaned up so the temp repos do not outlive the run. */
const cleanUp = async ({ cwd, worktreesRoot, branch }: { cwd: string; worktreesRoot: string; branch: string }) => {
	await removeWorktree({ cwd, worktreePath: join(worktreesRoot, branch), branch });
};

describe('createWorktree', () => {
	test('cuts the branch from the remote default and puts its worktree beside the repo, never inside it', async () => {
		const { cwd, worktreesRoot } = await setupMainCheckout();

		const created = await createWorktree({ cwd, branch: 'lo-70-drain', defaultBranch: 'main', owner: WorktreeOwner.Queue, reuseExisting: true });

		expect(created).toBe(join(worktreesRoot, 'lo-70-drain'));
		expect(typeof created === 'string' && existsSync(join(created, 'README.md'))).toBe(true);
		expect(
			execSync('git rev-parse --abbrev-ref HEAD', { cwd: String(created) })
				.toString()
				.trim(),
		).toBe('lo-70-drain');

		await cleanUp({ cwd, worktreesRoot, branch: 'lo-70-drain' });
	});

	test('nests a slash-bearing branch under the worktrees root, so a company branch convention needs no engine change', async () => {
		const { cwd, worktreesRoot } = await setupMainCheckout();

		const created = await createWorktree({ cwd, branch: 'feature/lo-70-drain', defaultBranch: 'main', owner: WorktreeOwner.Queue, reuseExisting: true });

		expect(created).toBe(join(worktreesRoot, 'feature', 'lo-70-drain'));

		await cleanUp({ cwd, worktreesRoot, branch: 'feature/lo-70-drain' });
	});

	test('continues in a worktree an earlier drain parked, rather than treating it as an error', async () => {
		const { cwd, worktreesRoot } = await setupMainCheckout();
		const progress: string[] = [];

		const first = await createWorktree({ cwd, branch: 'lo-70-drain', defaultBranch: 'main', owner: WorktreeOwner.Queue, reuseExisting: true });
		const second = await createWorktree({
			cwd,
			branch: 'lo-70-drain',
			defaultBranch: 'main',
			owner: WorktreeOwner.Queue,
			reuseExisting: true,
			onProgress: (message) => progress.push(message),
		});

		expect(second).toBe(first);
		expect(progress.some((line) => line.includes('continuing in it'))).toBe(true);

		await cleanUp({ cwd, worktreesRoot, branch: 'lo-70-drain' });
	});

	test('adopts a ticket branch a human pre-made, because that is what a branch-per-ticket workflow produces', async () => {
		const { cwd, worktreesRoot } = await setupMainCheckout();

		execSync('git branch lo-70-drain', { cwd, stdio: 'ignore' });

		const created = await createWorktree({ cwd, branch: 'lo-70-drain', defaultBranch: 'main', owner: WorktreeOwner.Queue, reuseExisting: true });

		expect(typeof created).toBe('string');
		expect(
			execSync('git rev-parse --abbrev-ref HEAD', { cwd: String(created) })
				.toString()
				.trim(),
		).toBe('lo-70-drain');

		await cleanUp({ cwd, worktreesRoot, branch: 'lo-70-drain' });
	});

	test('runs the repo’s setup command inside the fresh tree, so the worker never meets a tree with no dependencies', async () => {
		const { cwd, worktreesRoot } = await setupMainCheckout();
		const progress: string[] = [];

		const created = await createWorktree({
			cwd,
			branch: 'lo-70-drain',
			defaultBranch: 'main',
			owner: WorktreeOwner.Queue,
			reuseExisting: true,
			setup: 'echo installed > installed.txt',
			onProgress: (message) => progress.push(message),
		});

		expect(typeof created === 'string' && existsSync(join(created, 'installed.txt'))).toBe(true);
		expect(progress.some((line) => line.startsWith('setup finished'))).toBe(true);

		await cleanUp({ cwd, worktreesRoot, branch: 'lo-70-drain' });
	});

	test('ends the ticket when setup fails — an agent in a tree with no dependencies fails every gate for the wrong reason', async () => {
		const { cwd, worktreesRoot } = await setupMainCheckout();

		const created = await createWorktree({
			cwd,
			branch: 'lo-70-drain',
			defaultBranch: 'main',
			owner: WorktreeOwner.Queue,
			reuseExisting: true,
			setup: 'echo broken >&2; exit 3',
		});

		expect(created).toEqual({ error: expect.stringContaining("the queue's setup command failed") });

		await cleanUp({ cwd, worktreesRoot, branch: 'lo-70-drain' });
	});

	test('says git never answered when the checkout it was pointed at is not there, rather than reading silence as a refusal', async () => {
		const created = await createWorktree({
			cwd: '/lightsout/no/such/checkout',
			branch: 'lo-70-drain',
			defaultBranch: 'main',
			owner: WorktreeOwner.Queue,
			reuseExisting: true,
		});

		expect(created).toStrictEqual({ error: "git could not create a worktree for 'lo-70-drain': git did not answer" });
	});

	test('names the git command that refused when the branch cannot be cut at all', async () => {
		const { cwd } = await setupMainCheckout();

		const created = await createWorktree({ cwd, branch: 'lo-70-drain', defaultBranch: 'no-such-branch', owner: WorktreeOwner.Queue, reuseExisting: true });

		expect(created).toEqual({ error: expect.stringContaining("git could not create a worktree for 'lo-70-drain'") });
	});

	test('refuses a path a directory already occupies when reuse is off, naming the path', async () => {
		const { cwd, worktreePath } = await setupOccupiedPath({ branch: 'lo-70-drain' });

		const created = await createWorktree({ cwd, branch: 'lo-70-drain', defaultBranch: 'main', owner: WorktreeOwner.Implement, reuseExisting: false });

		expect(created).toEqual({ error: expect.stringContaining(worktreePath) });
		expect(existsSync(join(worktreePath, 'README.md'))).toBe(false);

		await rm(worktreePath, { recursive: true, force: true });
	});

	test('continues in a directory already at the path when reuse is on and nothing claims it', async () => {
		const { cwd, worktreePath } = await setupOccupiedPath({ branch: 'lo-70-drain' });
		const progress: string[] = [];

		const created = await createWorktree({
			cwd,
			branch: 'lo-70-drain',
			defaultBranch: 'main',
			owner: WorktreeOwner.Queue,
			reuseExisting: true,
			onProgress: (message) => progress.push(message),
		});

		expect(created).toBe(worktreePath);
		expect(progress.some((line) => line.includes(worktreePath))).toBe(true);

		await rm(worktreePath, { recursive: true, force: true });
	});

	test('refuses to continue in a tree whose ownership record names a different owner', async () => {
		const { cwd, worktreePath } = await setupOccupiedPath({ branch: 'lo-70-drain', owner: WorktreeOwner.Implement });

		const created = await createWorktree({ cwd, branch: 'lo-70-drain', defaultBranch: 'main', owner: WorktreeOwner.Queue, reuseExisting: true });

		expect(created).toEqual({ error: expect.stringContaining(worktreePath) });
		expect(created).toEqual({ error: expect.stringContaining('implement') });
		// Git answers filesystem-resolved paths, so the resolved spelling is the one
		// a listing would carry — asking for the other one would pass either way.
		expect(execSync('git worktree list', { cwd }).toString()).not.toContain(realpathSync(worktreePath));

		await rm(worktreePath, { recursive: true, force: true });
	});

	test('continues in a tree its own owner recorded', async () => {
		const { cwd, worktreePath } = await setupOccupiedPath({ branch: 'lo-70-drain', owner: WorktreeOwner.Queue });

		const created = await createWorktree({ cwd, branch: 'lo-70-drain', defaultBranch: 'main', owner: WorktreeOwner.Queue, reuseExisting: true });

		expect(created).toBe(worktreePath);

		await rm(worktreePath, { recursive: true, force: true });
	});

	test("records the tree's owner in the primary checkout as part of creating it", async () => {
		const { cwd, worktreesRoot } = await setupMainCheckout();

		const created = await createWorktree({ cwd, branch: 'lo-70-drain', defaultBranch: 'main', owner: WorktreeOwner.Queue, reuseExisting: false });

		expect(await readWorktreeRecord({ cwd, branch: 'lo-70-drain' })).toEqual(
			expect.objectContaining({ branch: 'lo-70-drain', owner: 'queue', worktreePath: created }),
		);
		expect(existsSync(join(cwd, '.lightsout', 'worktrees', 'lo-70-drain.json'))).toBe(true);

		await cleanUp({ cwd, worktreesRoot, branch: 'lo-70-drain' });
	});

	test('reports a failed setup command against the tree it ran in, leaving the tree attributable', async () => {
		const { cwd, worktreesRoot } = await setupMainCheckout();

		const created = await createWorktree({
			cwd,
			branch: 'lo-70-drain',
			defaultBranch: 'main',
			owner: WorktreeOwner.Queue,
			reuseExisting: false,
			setup: 'echo broken >&2; exit 3',
		});

		expect(created).toEqual({ error: expect.stringContaining(join(worktreesRoot, 'lo-70-drain')) });
		expect(created).toEqual({ error: expect.stringContaining('broken') });
		expect(await readWorktreeRecord({ cwd, branch: 'lo-70-drain' })).toEqual(expect.objectContaining({ owner: 'queue' }));

		await cleanUp({ cwd, worktreesRoot, branch: 'lo-70-drain' });
	});
});
