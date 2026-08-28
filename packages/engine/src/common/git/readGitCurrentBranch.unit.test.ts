import { execSync } from 'node:child_process';
import { describe, expect, test } from '@jest/globals';
import { readGitCurrentBranch } from '#src/common/git/readGitCurrentBranch.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

describe('readGitCurrentBranch', () => {
	test('a checkout standing on a feature branch reports that branch', async () => {
		const { cwd } = setupBranchRepo({ branch: 'lo-60-ship-command' });

		const branch = await readGitCurrentBranch({ cwd });

		expect(branch).toBe('lo-60-ship-command');
	});

	test('a detached HEAD reports no branch, because the literal word git answers with is not one', async () => {
		const { cwd } = setupBranchRepo({ branch: 'lo-60-ship-command' });

		execSync('git checkout -q --detach HEAD', { cwd, stdio: 'ignore' });
		const branch = await readGitCurrentBranch({ cwd });

		expect(branch).toBe(undefined);
	});

	test('a directory outside any worktree reports undefined rather than raising', async () => {
		const cwd = setupConsumerRepo({ git: false });

		const branch = await readGitCurrentBranch({ cwd });

		expect(branch).toBe(undefined);
	});

	test('a directory that does not exist reports undefined rather than the spawn failure', async () => {
		const branch = await readGitCurrentBranch({ cwd: '/lightsout/no/such/directory' });

		expect(branch).toBe(undefined);
	});
});
