import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { createTicketWorktree } from '#src/queue/createTicketWorktree.ts';
import { removeTicketWorktree } from '#src/queue/removeTicketWorktree.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** The repo a drain starts from, with an author git will accept. */
const setupMainCheckout = () => {
	const { cwd } = setupBranchRepo();

	execSync('git config user.name t && git config user.email t@t', { cwd, stdio: 'ignore' });

	return { cwd };
};

describe('removeTicketWorktree', () => {
	test('drops the worktree and its merged branch once the ticket has shipped', async () => {
		const { cwd } = setupMainCheckout();

		const created = await createTicketWorktree({ cwd, branch: 'lo-70-drain', defaultBranch: 'main' });

		await removeTicketWorktree({ cwd, worktreePath: String(created), branch: 'lo-70-drain' });

		expect(existsSync(String(created))).toBe(false);
		expect(execSync('git branch --list lo-70-drain', { cwd }).toString().trim()).toBe('');
	});

	test('never throws when the cleanup cannot be done — the merge already happened, and a failed tidy-up is not a failed ship', async () => {
		const { cwd } = setupMainCheckout();

		await expect(removeTicketWorktree({ cwd, worktreePath: '/lightsout/no/such/worktree', branch: 'never-existed' })).resolves.toBeUndefined();
	});

	test('never throws when the checkout is gone, so git cannot be run at all', async () => {
		await expect(
			removeTicketWorktree({ cwd: '/lightsout/no/such/checkout', worktreePath: '/lightsout/no/such/worktree', branch: 'never-existed' }),
		).resolves.toBeUndefined();
	});

	test('leaves a branch git does not consider merged, because a squashed merge leaves its commits unreachable', async () => {
		const { cwd } = setupMainCheckout();
		const created = await createTicketWorktree({ cwd, branch: 'lo-70-drain', defaultBranch: 'main' });

		writeFileSync(join(String(created), 'work.ts'), 'export const value = 1;\n');
		execSync('git add -A && git commit -qm work', { cwd: String(created), stdio: 'ignore' });

		await removeTicketWorktree({ cwd, worktreePath: String(created), branch: 'lo-70-drain' });

		expect(execSync('git branch --list lo-70-drain', { cwd }).toString().trim()).toContain('lo-70-drain');
	});
});
