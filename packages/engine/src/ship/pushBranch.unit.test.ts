import { execSync } from 'node:child_process';
import { describe, expect, test } from '@jest/globals';
import { pushBranch } from '#src/ship/pushBranch.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

describe('pushBranch', () => {
	test('a branch the remote has never seen lands there, with its upstream set', async () => {
		const { cwd, origin } = setupBranchRepo({ branch: 'lo-60-ship' });

		const pushed = await pushBranch({ branch: 'lo-60-ship', cwd });

		expect(pushed).toBe(true);
		expect(execSync("git branch --format='%(refname:short)'", { cwd: origin, encoding: 'utf8' })).toContain('lo-60-ship');
	});

	test('a branch already pushed and up to date pushes again as a no-op, which is what makes a re-run of ship safe', async () => {
		const { cwd } = setupBranchRepo({ branch: 'lo-60-ship' });

		execSync('git push -q -u origin lo-60-ship', { cwd, stdio: 'ignore' });
		const pushed = await pushBranch({ branch: 'lo-60-ship', cwd });

		expect(pushed).toBe(true);
	});

	test('a repo with no origin to push to answers false rather than raising', async () => {
		const cwd = setupConsumerRepo();

		const pushed = await pushBranch({ branch: 'lo-60-ship', cwd });

		expect(pushed).toBe(false);
	});

	test('a directory git cannot even be started in answers false', async () => {
		const pushed = await pushBranch({ branch: 'lo-60-ship', cwd: '/lightsout/no/such/directory' });

		expect(pushed).toBe(false);
	});
});
