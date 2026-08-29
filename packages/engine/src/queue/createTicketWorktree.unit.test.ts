import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { getWorktreesRoot } from '#src/queue/common/utils/getWorktreesRoot.ts';
import { createTicketWorktree } from '#src/queue/createTicketWorktree.ts';
import { removeTicketWorktree } from '#src/queue/removeTicketWorktree.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** The repo a drain starts from: fetched once already, standing on the default branch. */
const setupMainCheckout = () => {
	const { cwd } = setupBranchRepo();

	execSync('git config user.name t && git config user.email t@t', { cwd, stdio: 'ignore' });

	return { cwd };
};

/** Every worktree this test made, cleaned up so the temp repos do not outlive the run. */
const cleanUp = async ({ cwd, branch }: { cwd: string; branch: string }) => {
	await removeTicketWorktree({ cwd, worktreePath: join(getWorktreesRoot({ cwd }), branch), branch });
};

describe('createTicketWorktree', () => {
	test('cuts the branch from the remote default and puts its worktree beside the repo, never inside it', async () => {
		const { cwd } = setupMainCheckout();

		const created = await createTicketWorktree({ cwd, branch: 'lo-70-drain', defaultBranch: 'main' });

		expect(created).toBe(join(getWorktreesRoot({ cwd }), 'lo-70-drain'));
		expect(typeof created === 'string' && existsSync(join(created, 'README.md'))).toBe(true);
		expect(
			execSync('git rev-parse --abbrev-ref HEAD', { cwd: String(created) })
				.toString()
				.trim(),
		).toBe('lo-70-drain');

		await cleanUp({ cwd, branch: 'lo-70-drain' });
	});

	test('nests a slash-bearing branch under the worktrees root, so a company branch convention needs no engine change', async () => {
		const { cwd } = setupMainCheckout();

		const created = await createTicketWorktree({ cwd, branch: 'feature/lo-70-drain', defaultBranch: 'main' });

		expect(created).toBe(join(getWorktreesRoot({ cwd }), 'feature', 'lo-70-drain'));

		await cleanUp({ cwd, branch: 'feature/lo-70-drain' });
	});

	test('continues in a worktree an earlier drain parked, rather than treating it as an error', async () => {
		const { cwd } = setupMainCheckout();
		const progress: string[] = [];

		const first = await createTicketWorktree({ cwd, branch: 'lo-70-drain', defaultBranch: 'main' });
		const second = await createTicketWorktree({ cwd, branch: 'lo-70-drain', defaultBranch: 'main', onProgress: (message) => progress.push(message) });

		expect(second).toBe(first);
		expect(progress.some((line) => line.includes('continuing in it'))).toBe(true);

		await cleanUp({ cwd, branch: 'lo-70-drain' });
	});

	test('adopts a ticket branch a human pre-made, because that is what a branch-per-ticket workflow produces', async () => {
		const { cwd } = setupMainCheckout();

		execSync('git branch lo-70-drain', { cwd, stdio: 'ignore' });

		const created = await createTicketWorktree({ cwd, branch: 'lo-70-drain', defaultBranch: 'main' });

		expect(typeof created).toBe('string');
		expect(
			execSync('git rev-parse --abbrev-ref HEAD', { cwd: String(created) })
				.toString()
				.trim(),
		).toBe('lo-70-drain');

		await cleanUp({ cwd, branch: 'lo-70-drain' });
	});

	test('runs the repo’s setup command inside the fresh tree, so the worker never meets a tree with no dependencies', async () => {
		const { cwd } = setupMainCheckout();
		const progress: string[] = [];

		const created = await createTicketWorktree({
			cwd,
			branch: 'lo-70-drain',
			defaultBranch: 'main',
			setup: 'echo installed > installed.txt',
			onProgress: (message) => progress.push(message),
		});

		expect(typeof created === 'string' && existsSync(join(created, 'installed.txt'))).toBe(true);
		expect(progress.some((line) => line.startsWith('setup finished'))).toBe(true);

		await cleanUp({ cwd, branch: 'lo-70-drain' });
	});

	test('ends the ticket when setup fails — an agent in a tree with no dependencies fails every gate for the wrong reason', async () => {
		const { cwd } = setupMainCheckout();

		const created = await createTicketWorktree({ cwd, branch: 'lo-70-drain', defaultBranch: 'main', setup: 'echo broken >&2; exit 3' });

		expect(created).toEqual({ error: expect.stringContaining("the queue's setup command failed") });

		await cleanUp({ cwd, branch: 'lo-70-drain' });
	});

	test('says git never answered when the checkout it was pointed at is not there, rather than reading silence as a refusal', async () => {
		const created = await createTicketWorktree({ cwd: '/lightsout/no/such/checkout', branch: 'lo-70-drain', defaultBranch: 'main' });

		expect(created).toStrictEqual({ error: "git could not create a worktree for 'lo-70-drain': git did not answer" });
	});

	test('names the git command that refused when the branch cannot be cut at all', async () => {
		const { cwd } = setupMainCheckout();

		const created = await createTicketWorktree({ cwd, branch: 'lo-70-drain', defaultBranch: 'no-such-branch' });

		expect(created).toEqual({ error: expect.stringContaining("git could not create a worktree for 'lo-70-drain'") });
	});
});
