import { describe, expect, test } from '@jest/globals';
import { findOpenPullRequest } from '#src/ship/forge/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

/** A repo whose `gh pr list` answers with whatever this test wants it to. */
const setupList = async ({ stdout = '[]', exitCode = 0 }: { stdout?: string; exitCode?: number } = {}) => {
	const { readForgeLog } = stubForgeOnPath({ responses: { 'pr list': { stdout, exitCode } } });
	const cwd = await freshCwd();

	return { cwd, readForgeLog };
};

const openRow = '[{"number":41,"url":"https://forge.example/acme/repo/pull/41","title":"Ship a branch","headRefName":"lo-60-ship"}]';

describe('findOpenPullRequest', () => {
	test('an open pull request on the branch comes back as a summary, head branch and all', async () => {
		const { cwd } = await setupList({ stdout: openRow });

		const found = await findOpenPullRequest({ branch: 'lo-60-ship', cwd });

		expect(found).toStrictEqual({ number: 41, url: 'https://forge.example/acme/repo/pull/41', title: 'Ship a branch', branch: 'lo-60-ship' });
	});

	test('asks the forge only for the branch’s own open pull requests, so a stranger’s is never adopted', async () => {
		const { cwd, readForgeLog } = await setupList({ stdout: openRow });

		await findOpenPullRequest({ branch: 'lo-60-ship', cwd });

		expect(readForgeLog()[0]).toBe('pr list --head lo-60-ship --state open --json number,url,title,headRefName --limit 1');
	});

	test('no open pull request answers undefined, which is what makes the caller open one', async () => {
		const { cwd } = await setupList();

		const found = await findOpenPullRequest({ branch: 'lo-60-ship', cwd });

		expect(found).toBe(undefined);
	});

	test('a forge that refuses the read answers undefined rather than an empty summary', async () => {
		const { cwd } = await setupList({ stdout: '', exitCode: 1 });

		const found = await findOpenPullRequest({ branch: 'lo-60-ship', cwd });

		expect(found).toBe(undefined);
	});

	test('output that is not JSON at all answers undefined rather than raising out of the ship sequence', async () => {
		const { cwd } = await setupList({ stdout: 'gh: please run gh auth login' });

		const found = await findOpenPullRequest({ branch: 'lo-60-ship', cwd });

		expect(found).toBe(undefined);
	});

	test('a row missing a field answers undefined, because a summary with no number would reach the merge step', async () => {
		const { cwd } = await setupList({ stdout: '[{"number":41,"url":"https://forge.example/x/1"}]' });

		const found = await findOpenPullRequest({ branch: 'lo-60-ship', cwd });

		expect(found).toBe(undefined);
	});
});
