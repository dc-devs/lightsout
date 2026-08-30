import { describe, expect, test } from '@jest/globals';
import { ShipMergeMethod } from '#src/contracts/index.ts';
import { mergePullRequest } from '#src/ship/forge/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

/** A forge that merges as the test says it does, and reports the commit it produced. */
const setupMerge = async ({
	mergeExit = 0,
	mergeStderr = '',
	viewStdout = '{"mergeCommit":{"oid":"0f1e2d3c"}}',
	viewStderr = '',
}: {
	mergeExit?: number;
	mergeStderr?: string;
	viewStdout?: string;
	viewStderr?: string;
} = {}) => {
	const { readForgeLog } = stubForgeOnPath({
		responses: { 'pr merge': { exitCode: mergeExit, stderr: mergeStderr }, 'pr view': { stdout: viewStdout, stderr: viewStderr } },
	});
	const cwd = await freshCwd();

	return { cwd, readForgeLog };
};

describe('mergePullRequest', () => {
	test('answers with the commit the merge produced on the default branch', async () => {
		const { cwd } = await setupMerge();

		const mergeCommit = await mergePullRequest({ prNumber: 41, mergeMethod: ShipMergeMethod.Merge, cwd });

		expect(mergeCommit).toBe('0f1e2d3c');
	});

	test('asks the forge for the configured method and to delete the branch, which is the cleanup step', async () => {
		const { cwd, readForgeLog } = await setupMerge();

		await mergePullRequest({ prNumber: 41, mergeMethod: ShipMergeMethod.Squash, cwd });

		expect(readForgeLog()[0]).toBe('pr merge 41 --squash --delete-branch');
	});

	test('a refused merge answers with the forge’s own reason, once the read-back confirms nothing landed', async () => {
		const { cwd, readForgeLog } = await setupMerge({ mergeExit: 1, mergeStderr: 'protected branch', viewStdout: '{"state":"OPEN","mergeCommit":null}' });

		const mergeCommit = await mergePullRequest({ prNumber: 41, mergeMethod: ShipMergeMethod.Merge, cwd });

		expect(mergeCommit).toStrictEqual({ stderr: 'protected branch' });
		expect(readForgeLog()).toStrictEqual(['pr merge 41 --merge --delete-branch', 'pr view 41 --json state,mergeCommit']);
	});

	test('a merge whose command failed only on local cleanup is still a merge — the forge’s state outranks the exit code', async () => {
		const { cwd } = await setupMerge({
			mergeExit: 1,
			mergeStderr: "failed to run git: fatal: 'main' is already used by worktree at '/repo'",
			viewStdout: '{"state":"MERGED","mergeCommit":{"oid":"a1b2c3d4"}}',
		});

		const mergeCommit = await mergePullRequest({ prNumber: 41, mergeMethod: ShipMergeMethod.Merge, cwd });

		expect(mergeCommit).toBe('a1b2c3d4');
	});

	test('a failed merge whose read-back cannot be parsed keeps the failure, rather than guessing the merge landed', async () => {
		const { cwd } = await setupMerge({ mergeExit: 1, mergeStderr: 'protected branch', viewStdout: 'not json at all' });

		const mergeCommit = await mergePullRequest({ prNumber: 41, mergeMethod: ShipMergeMethod.Merge, cwd });

		expect(mergeCommit).toStrictEqual({ stderr: 'protected branch' });
	});

	test('a merge whose commit cannot be read answers a failure rather than a made-up commit', async () => {
		const { cwd } = await setupMerge({ viewStdout: '{"mergeCommit":null}' });

		const mergeCommit = await mergePullRequest({ prNumber: 41, mergeMethod: ShipMergeMethod.Merge, cwd });

		expect(mergeCommit).toStrictEqual({ stderr: '' });
	});

	test('a commit the forge would not name answers the read-back’s own words, not whatever the merge printed', async () => {
		const { cwd } = await setupMerge({
			mergeStderr: 'merged, and the branch was deleted',
			viewStdout: '{"mergeCommit":null}',
			viewStderr: 'could not read the merge commit',
		});

		const mergeCommit = await mergePullRequest({ prNumber: 41, mergeMethod: ShipMergeMethod.Merge, cwd });

		expect(mergeCommit).toStrictEqual({ stderr: 'could not read the merge commit' });
	});
});
