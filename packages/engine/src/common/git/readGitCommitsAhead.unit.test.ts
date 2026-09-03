import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readGitCommitsAhead } from '#src/common/git/readGitCommitsAhead.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** One more commit on the branch the repo is standing on. */
const addCommit = ({ cwd, name }: { cwd: string; name: string }) => {
	writeFileSync(join(cwd, name), `# ${name}\n`);
	execSync(`git add -A && git -c user.name=t -c user.email=t@t commit -qm ${name}`, { cwd, stdio: 'ignore' });
};

describe('readGitCommitsAhead', () => {
	test('counts the commits a branch carries that the default branch does not', async () => {
		const { cwd } = setupBranchRepo({ branch: 'lo-70-drain' });

		addCommit({ cwd, name: 'second.md' });

		expect(await readGitCommitsAhead({ cwd, defaultBranch: 'main' })).toBe(2);
	});

	test('answers zero for a branch level with the default branch, which is not the same as an unreadable one', async () => {
		const { cwd } = setupBranchRepo();

		expect(await readGitCommitsAhead({ cwd, defaultBranch: 'main' })).toBe(0);
	});

	test('answers undefined when the default branch has no remote ref to count against', async () => {
		const { cwd } = setupBranchRepo({ branch: 'lo-70-drain' });

		expect(await readGitCommitsAhead({ cwd, defaultBranch: 'no-such-default' })).toBe(undefined);
	});

	test('answers undefined outside a git worktree, rather than folding the missing answer into zero', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'lightsout-plain-'));

		expect(await readGitCommitsAhead({ cwd, defaultBranch: 'main' })).toBe(undefined);
	});

	test('answers undefined for a directory that does not exist, rather than raising the spawn failure', async () => {
		expect(await readGitCommitsAhead({ cwd: '/lightsout/no/such/directory', defaultBranch: 'main' })).toBe(undefined);
	});
});
