import { execSync } from 'node:child_process';
import { describe, expect, test } from '@jest/globals';
import { pushBranch } from '#src/ship/pushBranch.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

describe('pushBranch', () => {
	test('a branch the remote has never seen lands there, with its upstream set', async () => {
		const { cwd, origin } = setupBranchRepo({ branch: 'lo-60-ship' });

		const failure = await pushBranch({ branch: 'lo-60-ship', cwd });

		expect(failure).toBe(undefined);
		expect(execSync("git branch --format='%(refname:short)'", { cwd: origin, encoding: 'utf8' })).toContain('lo-60-ship');
	});

	test('a branch already pushed and up to date pushes again as a no-op, which is what makes a re-run of ship safe', async () => {
		const { cwd } = setupBranchRepo({ branch: 'lo-60-ship' });

		execSync('git push -q -u origin lo-60-ship', { cwd, stdio: 'ignore' });
		const failure = await pushBranch({ branch: 'lo-60-ship', cwd });

		expect(failure).toBe(undefined);
	});

	test('a repo with no origin to push to answers with git’s own words rather than raising', async () => {
		const cwd = setupConsumerRepo();

		const failure = await pushBranch({ branch: 'lo-60-ship', cwd });

		expect(failure).toEqual({ stderr: expect.stringContaining('origin') });
	});

	test('a directory git cannot even be started in answers a failure carrying whatever the platform said', async () => {
		const failure = await pushBranch({ branch: 'lo-60-ship', cwd: '/lightsout/no/such/directory' });

		expect(failure).toBeDefined();
		expect(failure?.stderr).toEqual(expect.any(String));
	});
});
