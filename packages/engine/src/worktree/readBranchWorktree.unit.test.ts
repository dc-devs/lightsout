import { execSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readBranchWorktree } from '#src/worktree/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/**
 * A repository holding two branches: one checked out in a linked worktree
 * beside it, and one that exists as a ref and nothing more.
 */
const setupTwoBranches = () => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-70-drain');

	execSync(`git worktree add -q -b lo-70-drain "${worktree}" main`, { cwd, stdio: 'ignore' });
	execSync('git branch lo-70-idle main', { cwd, stdio: 'ignore' });

	return { cwd, worktree };
};

describe('readBranchWorktree', () => {
	test('answers the worktree a branch is checked out in, and undefined for a branch checked out nowhere', async () => {
		const { cwd, worktree } = setupTwoBranches();

		const checkedOut = await readBranchWorktree({ cwd, branch: 'lo-70-drain' });
		const idle = await readBranchWorktree({ cwd, branch: 'lo-70-idle' });

		expect(checkedOut === undefined ? undefined : realpathSync(checkedOut)).toBe(realpathSync(worktree));
		expect(idle).toBe(undefined);
	});

	test('answers undefined when the list cannot be read at all', async () => {
		const cwd = join(tmpdir(), 'lightsout-no-such-checkout');

		const found = await readBranchWorktree({ cwd, branch: 'lo-70-drain' });

		expect(found).toBe(undefined);
	});

	test('answers undefined outside a repository rather than throwing', async () => {
		const cwd = setupConsumerRepo({ git: false });

		const found = await readBranchWorktree({ cwd, branch: 'lo-70-drain' });

		expect(found).toBe(undefined);
	});
});
