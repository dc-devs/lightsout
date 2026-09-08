import { execSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readGitPrimaryCheckout } from '#src/common/git/readGitPrimaryCheckout.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

describe('readGitPrimaryCheckout', () => {
	test('a primary checkout names itself, so a command run there reads its own files', async () => {
		const { cwd } = setupBranchRepo();

		const primary = await readGitPrimaryCheckout({ cwd });

		expect(primary === undefined ? undefined : realpathSync(primary)).toBe(realpathSync(cwd));
	});

	test('a linked worktree names the checkout it was added from, which is where its gitignored files live', async () => {
		const { cwd } = setupBranchRepo();
		const worktree = join(cwd, '.worktrees', 'lo-60-ship-command');

		execSync(`git worktree add -q -b lo-60-ship-command "${worktree}" main`, { cwd, stdio: 'ignore' });

		const primary = await readGitPrimaryCheckout({ cwd: worktree });

		expect(primary === undefined ? undefined : realpathSync(primary)).toBe(realpathSync(cwd));
	});

	test('a directory outside any repository reports undefined rather than raising', async () => {
		const cwd = setupConsumerRepo({ git: false });

		const primary = await readGitPrimaryCheckout({ cwd });

		expect(primary).toBe(undefined);
	});

	test('a directory that does not exist reports undefined rather than the spawn failure', async () => {
		const primary = await readGitPrimaryCheckout({ cwd: '/lightsout/no/such/directory' });

		expect(primary).toBe(undefined);
	});
});
