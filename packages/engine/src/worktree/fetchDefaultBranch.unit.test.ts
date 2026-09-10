import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { fetchDefaultBranch } from '#src/worktree/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

// Git is real here rather than stubbed, as it is for every other reader of a
// remote in this repo: what this answers is git's own reading of a fetch and of
// `origin/HEAD`, and a stubbed git would prove nothing about either. Only the
// remote is local — a bare repo on disk — so nothing leaves the machine.

/** A repository whose remote is reachable and whose `origin/HEAD` is already set. */
const setupReachableRemote = () => {
	const { cwd } = setupBranchRepo({ branch: 'lo-142-worktree' });

	return { cwd };
};

/**
 * A repository whose `origin/HEAD` was never set, pointed at a remote holding no
 * commits — so the fetch works and still cannot repair the missing head, which
 * is the state a caller has to be told about rather than guessed past.
 */
const setupUnsetRemoteHead = () => {
	const { cwd } = setupBranchRepo({ branch: 'lo-142-worktree', remoteHead: false });
	const empty = mkdtempSync(join(tmpdir(), 'lightsout-empty-origin-'));

	execSync('git init -q --bare -b main .', { cwd: empty, stdio: 'ignore' });
	execSync(`git remote set-url origin ${empty}`, { cwd, stdio: 'ignore' });

	return { cwd };
};

/** A repository whose `origin` names a path holding no repository, so the fetch cannot work. */
const setupUnreachableRemote = () => {
	const { cwd } = setupBranchRepo({ branch: 'lo-142-worktree' });

	execSync('git remote set-url origin /lightsout/no/such/origin', { cwd, stdio: 'ignore' });

	return { cwd };
};

describe('fetchDefaultBranch', () => {
	test('answers the remote default branch with the origin prefix stripped', async () => {
		const { cwd } = setupReachableRemote();

		const defaultBranch = await fetchDefaultBranch({ cwd });

		expect(defaultBranch).toBe('main');
	});

	test('refuses an unset remote head, naming the command that sets it', async () => {
		const { cwd } = setupUnsetRemoteHead();

		const defaultBranch = await fetchDefaultBranch({ cwd });

		expect(defaultBranch).toEqual({ error: expect.stringContaining('git remote set-head origin --auto') });
	});

	test('reports a failed fetch rather than answering from a stale remote', async () => {
		const { cwd } = setupUnreachableRemote();

		const defaultBranch = await fetchDefaultBranch({ cwd });

		expect(defaultBranch).toEqual({ error: expect.stringContaining('/lightsout/no/such/origin') });
	});
});
