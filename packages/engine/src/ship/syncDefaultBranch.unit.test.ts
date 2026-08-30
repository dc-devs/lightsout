import { execSync } from 'node:child_process';
import { describe, expect, test } from '@jest/globals';
import { syncDefaultBranch } from '#src/ship/syncDefaultBranch.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** A checkout standing on a feature branch, optionally with that branch already landed on the default one. */
const setupSync = ({ merged = false, worktree = true }: { merged?: boolean; worktree?: boolean } = {}) => {
	const progress: string[] = [];
	const { cwd } = worktree ? setupBranchRepo({ branch: 'lo-60-ship' }) : { cwd: '/lightsout/no/such/directory' };

	if (merged) {
		const author = '-c user.name=t -c user.email=t@t';

		execSync(`git checkout -q main && git ${author} merge -q --ff-only lo-60-ship && git push -q origin main && git checkout -q lo-60-ship`, {
			cwd,
			stdio: 'ignore',
		});
	}

	return { cwd, progress, onProgress: (message: string) => progress.push(message) };
};

/** Every local branch the repo still has. */
const readBranches = ({ cwd }: { cwd: string }) => execSync("git branch --format='%(refname:short)'", { cwd, encoding: 'utf8' }).trim().split('\n');

describe('syncDefaultBranch', () => {
	test('moves to the default branch, brings it up to date, and drops the branch the forge has already merged', async () => {
		const { cwd, progress, onProgress } = setupSync({ merged: true });

		await syncDefaultBranch({ cwd, defaultBranch: 'main', branch: 'lo-60-ship', onProgress });

		expect(readBranches({ cwd })).toStrictEqual(['main']);
		expect(progress).toStrictEqual(['sync: git checkout main', 'sync: git pull --ff-only', 'sync: git branch -d lo-60-ship']);
	});

	test('a branch git does not consider merged is left alone rather than destroyed, and the step says so', async () => {
		const { cwd, onProgress } = setupSync();

		await syncDefaultBranch({ cwd, defaultBranch: 'main', branch: 'lo-60-ship', onProgress });

		expect(readBranches({ cwd })).toContain('lo-60-ship');
	});

	test('skips itself entirely in a linked worktree, where the default branch belongs to the primary checkout', async () => {
		const { cwd, progress, onProgress } = setupSync();
		const linked = `${cwd}-linked`;

		execSync(`git worktree add -q ${linked} -b lo-61-linked`, { cwd, stdio: 'ignore' });

		await syncDefaultBranch({ cwd: linked, defaultBranch: 'main', branch: 'lo-61-linked', onProgress });

		expect(progress).toStrictEqual(['sync: skipped — this checkout is a linked worktree, and the default branch lives in the primary one']);
		expect(readBranches({ cwd })).toContain('lo-61-linked');
	});

	test('a repo where nothing works at all still returns, because the merge has already happened by now', async () => {
		const { cwd, progress, onProgress } = setupSync({ worktree: false });

		await syncDefaultBranch({ cwd, defaultBranch: 'main', branch: 'lo-60-ship', onProgress });

		expect(progress.every((line) => line.includes('did not work'))).toBe(true);
		expect(progress).toHaveLength(3);
	});

	test('says nothing at all when no progress sink was handed in', async () => {
		const { cwd } = setupSync({ merged: true });

		await expect(syncDefaultBranch({ cwd, defaultBranch: 'main', branch: 'lo-60-ship' })).resolves.toBe(undefined);
	});
});
