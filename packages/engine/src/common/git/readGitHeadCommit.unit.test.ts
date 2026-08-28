import { execSync } from 'node:child_process';
import { describe, expect, test } from '@jest/globals';
import { readGitHeadCommit } from '#src/common/git/readGitHeadCommit.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

describe('readGitHeadCommit', () => {
	test('a repo with one commit reports that commit', async () => {
		const cwd = setupConsumerRepo();

		const commit = await readGitHeadCommit({ cwd });

		// the full sha, trimmed — a grade stamps it so a verdict read back weeks
		// later says which code it was measured against
		expect(commit).toBe(execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim());
		expect(commit ?? '').toMatch(/^[0-9a-f]{40}$/);
	});

	test('a directory that does not exist reports no commit rather than raising the spawn failure', async () => {
		// git cannot even be started here, which is not the caller's problem: the
		// stamp is an optional refinement, so an unanswerable question is undefined
		const commit = await readGitHeadCommit({ cwd: '/lightsout/no/such/directory' });

		expect(commit).toBe(undefined);
	});

	test('a directory outside any worktree reports undefined', async () => {
		const cwd = setupConsumerRepo({ git: false });

		const commit = await readGitHeadCommit({ cwd });

		// absence is a value: the grade records no commit rather than inventing one
		expect(commit).toBe(undefined);
	});
});
