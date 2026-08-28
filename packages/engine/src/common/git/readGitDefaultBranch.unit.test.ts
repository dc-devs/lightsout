import { describe, expect, test } from '@jest/globals';
import { readGitDefaultBranch } from '#src/common/git/readGitDefaultBranch.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

describe('readGitDefaultBranch', () => {
	test('a repo whose remote head is set reports the branch behind it, without the remote prefix', async () => {
		const { cwd } = setupBranchRepo({ branch: 'lo-60-ship-command' });

		const defaultBranch = await readGitDefaultBranch({ cwd });

		expect(defaultBranch).toBe('main');
	});

	test('a repo whose remote head was never set reports undefined rather than guessing a name ship would merge into', async () => {
		const { cwd } = setupBranchRepo({ branch: 'lo-60-ship-command', remoteHead: false });

		const defaultBranch = await readGitDefaultBranch({ cwd });

		expect(defaultBranch).toBe(undefined);
	});

	test('a directory outside any worktree reports undefined rather than raising', async () => {
		const cwd = setupConsumerRepo({ git: false });

		const defaultBranch = await readGitDefaultBranch({ cwd });

		expect(defaultBranch).toBe(undefined);
	});

	test('a directory that does not exist reports undefined rather than the spawn failure', async () => {
		const defaultBranch = await readGitDefaultBranch({ cwd: '/lightsout/no/such/directory' });

		expect(defaultBranch).toBe(undefined);
	});
});
