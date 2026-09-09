import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { restorePreIntegrationState } from '#src/ship/integration/restorePreIntegrationState.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

const git = ({ cwd, command }: { cwd: string; command: string }) => execSync(`git ${command}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** A git command whose non-zero exit is part of the arrangement — the conflicting merge, and the merge check that finds none. */
const tryGit = ({ cwd, command }: { cwd: string; command: string }) => {
	try {
		return git({ cwd, command }).trim();
	} catch {
		return '';
	}
};

const commit = ({ cwd, message }: { cwd: string; message: string }) => {
	git({ cwd, command: 'add -A' });
	git({ cwd, command: `commit -qm "${message}"` });
};

/** The commit the branch stands on. */
const readHead = ({ cwd }: { cwd: string }) => git({ cwd, command: 'rev-parse HEAD' }).trim();

/** Uncommitted tracked and untracked paths, empty when the tree is clean. */
const readDirtyPaths = ({ cwd }: { cwd: string }) => git({ cwd, command: 'status --porcelain' }).trim();

/** The commit being merged in, empty when no merge is in progress. */
const readMergeHead = ({ cwd }: { cwd: string }) => tryGit({ cwd, command: 'rev-parse -q --verify MERGE_HEAD' });

/**
 * A feature branch mid-recovery: `main` and the branch each wrote the same file
 * differently, so merging `main` in leaves the path unmerged and the merge open,
 * and an agent attempt has written an untracked file since the baseline commit.
 */
const setupConflictedMerge = () => {
	const branch = 'lo-89-ship';
	const { cwd } = setupBranchRepo({ branch });

	git({ cwd, command: 'checkout -q main' });
	writeFileSync(join(cwd, 'shared.md'), 'main wrote this\n');
	commit({ cwd, message: 'main writes the shared file' });
	git({ cwd, command: `checkout -q ${branch}` });
	writeFileSync(join(cwd, 'shared.md'), 'the feature wrote this instead\n');
	commit({ cwd, message: 'the feature writes the shared file' });

	const baselineCommit = readHead({ cwd });

	tryGit({ cwd, command: 'merge --no-edit main' });
	writeFileSync(join(cwd, 'stray.md'), 'written since the baseline\n');

	return { cwd, baselineCommit };
};

/**
 * The same recovery with nothing to abort: the remote default branch was already
 * an ancestor, so no merge was ever started, and only a gate repair's edits and
 * its untracked file stand between the tree and the baseline commit.
 */
const setupWithoutMerge = () => {
	const { cwd } = setupBranchRepo({ branch: 'lo-89-ship' });
	const baselineCommit = readHead({ cwd });

	writeFileSync(join(cwd, 'feature.md'), 'a gate repair the recovery is throwing away\n');
	writeFileSync(join(cwd, 'stray.md'), 'written since the baseline\n');

	return { cwd, baselineCommit };
};

describe('restorePreIntegrationState', () => {
	test('puts the branch back at the baseline commit with a clean tree', async () => {
		const { cwd, baselineCommit } = setupConflictedMerge();

		const failure = await restorePreIntegrationState({ cwd, baselineCommit });

		// a verified restoration answers nothing to report
		expect(failure).toBeUndefined();
		expect(readHead({ cwd })).toBe(baselineCommit);
		// the merge is over and the agent's stray file is gone, so the next caller
		// meets the branch exactly as ship found it
		expect(readMergeHead({ cwd })).toBe('');
		expect(readDirtyPaths({ cwd })).toBe('');
	});

	test('completes the restore even when there is no merge to abort', async () => {
		const { cwd, baselineCommit } = setupWithoutMerge();

		const failure = await restorePreIntegrationState({ cwd, baselineCommit });

		// nothing to abort is not a failed restore: the reset and the cleanup still
		// run, and the branch still ends at its baseline with a clean tree
		expect(failure).toBeUndefined();
		expect(readHead({ cwd })).toBe(baselineCommit);
		expect(readDirtyPaths({ cwd })).toBe('');
	});
});
