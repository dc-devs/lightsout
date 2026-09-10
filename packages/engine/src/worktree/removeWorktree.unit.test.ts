import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { WorktreeOwner } from '#src/contracts/index.ts';
import { createWorktree, readWorktreeRecord, removeWorktree } from '#src/worktree/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** The repo a drain starts from, with an author git will accept. */
const setupMainCheckout = () => {
	const { cwd } = setupBranchRepo();

	execSync('git config user.name t && git config user.email t@t', { cwd, stdio: 'ignore' });

	return { cwd };
};

/**
 * What a refused removal says: the engine's own half naming the tree, then
 * git's sentence after the colon. Git owns that wording and is free to reword
 * it, so what is pinned is that something of git's is carried at all.
 */
const refusal = /^git could not remove the worktree at \/lightsout\/no\/such\/worktree: \S/;

/** A checkout holding a merged branch that no worktree has checked out — a branch `git branch -d` will take. */
const setupSpareBranch = ({ branch }: { branch: string }) => {
	const { cwd } = setupMainCheckout();

	execSync(`git branch ${branch}`, { cwd, stdio: 'ignore' });

	return { cwd };
};

describe('removeWorktree', () => {
	test('drops the worktree and its merged branch once the ticket has shipped', async () => {
		const { cwd } = setupMainCheckout();

		const created = await createWorktree({
			cwd,
			branch: 'lo-70-drain',
			defaultBranch: 'main',
			owner: WorktreeOwner.Queue,
			reuseExisting: true,
		});

		await removeWorktree({ cwd, worktreePath: String(created), branch: 'lo-70-drain' });

		expect(existsSync(String(created))).toBe(false);
		expect(execSync('git branch --list lo-70-drain', { cwd }).toString().trim()).toBe('');
	});

	test('never throws when the cleanup cannot be done — the merge already happened, and a failed tidy-up is not a failed ship', async () => {
		const { cwd } = setupMainCheckout();

		const result = await removeWorktree({ cwd, worktreePath: '/lightsout/no/such/worktree', branch: 'never-existed' });

		expect(result).toEqual(expect.objectContaining({ error: expect.any(String) }));
	});

	test('never throws when the checkout is gone, so git cannot be run at all', async () => {
		const settled = await removeWorktree({ cwd: '/lightsout/no/such/checkout', worktreePath: '/lightsout/no/such/worktree', branch: 'never-existed' }).catch(
			(thrown: unknown) => thrown,
		);

		// A throw would land here as the error itself, so pinning the sentence pins
		// both halves: nothing was thrown, and silence was read as silence.
		expect(settled).toStrictEqual({ error: 'git could not remove the worktree at /lightsout/no/such/worktree: git did not answer' });
	});

	test('leaves a branch git does not consider merged, because a squashed merge leaves its commits unreachable', async () => {
		const { cwd } = setupMainCheckout();
		const created = await createWorktree({
			cwd,
			branch: 'lo-70-drain',
			defaultBranch: 'main',
			owner: WorktreeOwner.Queue,
			reuseExisting: true,
		});

		writeFileSync(join(String(created), 'work.ts'), 'export const value = 1;\n');
		execSync('git add -A && git commit -qm work', { cwd: String(created), stdio: 'ignore' });

		await removeWorktree({ cwd, worktreePath: String(created), branch: 'lo-70-drain' });

		expect(execSync('git branch --list lo-70-drain', { cwd }).toString().trim()).toContain('lo-70-drain');
	});

	test('answers no failure on a clean removal and leaves the ownership record for its caller', async () => {
		const { cwd } = setupMainCheckout();
		const created = await createWorktree({
			cwd,
			branch: 'lo-70-drain',
			defaultBranch: 'main',
			owner: WorktreeOwner.Queue,
			reuseExisting: true,
		});

		const failure = await removeWorktree({ cwd, worktreePath: String(created), branch: 'lo-70-drain' });

		const record = await readWorktreeRecord({ cwd, branch: 'lo-70-drain' });
		expect(failure).toBeUndefined();
		expect(record).toEqual(expect.objectContaining({ branch: 'lo-70-drain', owner: 'queue', worktreePath: String(created) }));
	});

	test('answers a failure when git refuses to remove the tree, without throwing', async () => {
		const { cwd } = setupSpareBranch({ branch: 'lo-70-spare' });

		const failure = await removeWorktree({ cwd, worktreePath: '/lightsout/no/such/worktree', branch: 'lo-70-spare' });

		expect(failure).toEqual(expect.objectContaining({ error: expect.stringMatching(refusal) }));
		expect(execSync('git branch --list lo-70-spare', { cwd }).toString().trim()).toBe('');
	});

	test('treats a branch git will not delete as an ordinary outcome rather than a failure', async () => {
		const { cwd } = setupMainCheckout();
		const created = await createWorktree({
			cwd,
			branch: 'lo-70-unmerged',
			defaultBranch: 'main',
			owner: WorktreeOwner.Queue,
			reuseExisting: true,
		});
		writeFileSync(join(String(created), 'work.ts'), 'export const value = 1;\n');
		execSync('git add -A && git commit -qm work', { cwd: String(created), stdio: 'ignore' });

		const failure = await removeWorktree({ cwd, worktreePath: String(created), branch: 'lo-70-unmerged' });

		expect(failure).toBeUndefined();
		expect(execSync('git branch --list lo-70-unmerged', { cwd }).toString().trim()).toContain('lo-70-unmerged');
	});
});
