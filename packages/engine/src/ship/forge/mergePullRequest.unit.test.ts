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
}: {
	mergeExit?: number;
	mergeStderr?: string;
	viewStdout?: string;
} = {}) => {
	const { readForgeLog } = stubForgeOnPath({
		responses: { 'pr merge': { exitCode: mergeExit, stderr: mergeStderr }, 'pr view': { stdout: viewStdout } },
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

	test('a refused merge answers undefined, and never asks for a commit that was never made', async () => {
		const { cwd, readForgeLog } = await setupMerge({ mergeExit: 1, mergeStderr: 'protected branch' });

		const mergeCommit = await mergePullRequest({ prNumber: 41, mergeMethod: ShipMergeMethod.Merge, cwd });

		expect(mergeCommit).toBe(undefined);
		expect(readForgeLog()).toStrictEqual(['pr merge 41 --merge --delete-branch']);
	});

	test('a merge whose commit cannot be read answers undefined rather than a made-up commit', async () => {
		const { cwd } = await setupMerge({ viewStdout: '{"mergeCommit":null}' });

		const mergeCommit = await mergePullRequest({ prNumber: 41, mergeMethod: ShipMergeMethod.Merge, cwd });

		expect(mergeCommit).toBe(undefined);
	});
});
