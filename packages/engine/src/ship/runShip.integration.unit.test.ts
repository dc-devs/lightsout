import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { ShipMergeMethod } from '#src/contracts/index.ts';
import { resolveShipSettings } from '#src/ship/index.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { mockShip } from '#tests/helpers/mockShip.ts';
import { setupShipScenario as setupShip } from '#tests/helpers/setupShipScenario.ts';
import { shipScenarioFixtures } from '#tests/helpers/shipScenarioFixtures.ts';
import { shipScenarioGit } from '#tests/helpers/shipScenarioGit.ts';

// Mocked Imports
// -------------------------
// Git is real throughout — a real worktree, a real bare origin, real merges,
// real pushes — because integrating the default branch is the whole subject
// here and a stubbed git would prove none of it. What is stubbed is everything
// that would either leave the machine or take half an hour: the repository's
// own gates, the forge, and the check wait whose ceiling no arrangement can
// bring closer. The harness is NOT stubbed away: a scripted driver answers the
// real contract invoker, so what a recovery attempt was handed is read off the
// invocation it received.
jest.mock('#src/gates/index.ts', () => ({ runGates: (params: Parameters<typeof mockShip.runGates>[0]) => mockShip.runGates(params) }));
jest.mock('#src/ship/waitForChecks.ts', () => ({ waitForChecks: (params: Parameters<typeof mockShip.waitForChecks>[0]) => mockShip.waitForChecks(params) }));
jest.mock('#src/ship/forge/index.ts', () => ({
	PullRequestState: { Open: 'open', Merged: 'merged' },
	readForgeAuth: (params: Parameters<typeof mockShip.readForgeAuth>[0]) => mockShip.readForgeAuth(params),
	findPullRequest: (params: Parameters<typeof mockShip.findPullRequest>[0]) => mockShip.findPullRequest(params),
	createPullRequest: (params: Parameters<typeof mockShip.createPullRequest>[0]) => mockShip.createPullRequest(params),
	mergePullRequest: (params: Parameters<typeof mockShip.mergePullRequest>[0]) => mockShip.mergePullRequest(params),
	readPullRequestChecks: (params: Parameters<typeof mockShip.readPullRequestChecks>[0]) => mockShip.readPullRequestChecks(params),
	readCheckFailureLogs: (params: Parameters<typeof mockShip.readCheckFailureLogs>[0]) => mockShip.readCheckFailureLogs(params),
}));
jest.mock('#src/common/git/readGitHeadCommit.ts', () => ({
	readGitHeadCommit: (params: Parameters<typeof mockShip.readGitHeadCommit>[0]) => mockShip.readGitHeadCommit(params),
}));
// -------------------------

const { branch, conflictPath, green } = shipScenarioFixtures;
const { git, gitOut, headOf, isAncestor, lockStrayDirectory, remoteTip, writeHookScript } = shipScenarioGit;

// What the shared sequence does to the branch itself: the remote default branch
// merged in, the conflicts and red gates it recovers from, the one commit it
// makes once the gates are green, and the baseline it puts back when recovery
// runs out. The attempt budget and the CI evidence that spends it are the
// sibling file's subject.
describe('runShip', () => {
	test('rejects uncommitted entry work before any preparation', async () => {
		const hook = writeHookScript({ body: "require('node:fs').writeFileSync('hook-ran.txt', 'yes\\n');" });
		const { baseline, cwd, invocations, mergeRequests, ship } = setupShip({
			dirty: { 'notes.md': 'half a thought\n', 'dist/bundle.txt': 'generated, and never committed\n' },
			staged: { 'feature.md': '# feature, edited and staged\n' },
			settings: { preShip: `node ${hook}` },
		});

		const result = await ship();

		expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: 'dirty-tree', detail: expect.stringContaining('notes.md') }));
		expect(result.detail).toContain('feature.md');
		// nothing prepared, nothing spawned, nothing offered, nothing pushed
		expect(existsSync(join(cwd, 'hook-ran.txt'))).toBe(false);
		expect(invocations).toStrictEqual([]);
		expect(mergeRequests).toStrictEqual([]);
		expect(remoteTip({ cwd })).toBe('');
		expect(headOf({ cwd })).toBe(baseline);
		// `-uall` because git collapses an untracked directory to its name alone.
		expect(gitOut({ cwd, command: 'status --porcelain -uall' })).toContain('dist/bundle.txt');
	});

	test('verifies ship-generated release changes before committing them', async () => {
		const hook = writeHookScript({
			body: [
				"const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs');",
				"mkdirSync('dist', { recursive: true });",
				"writeFileSync('dist/bundle.txt', 'rebuilt by the release hook\\n');",
				"appendFileSync('feature.md', 'version 2\\n');",
				'',
			].join('\n'),
		});
		const { baseline, cwd, gateViews, ship } = setupShip({ settings: { preShip: `node ${hook}` } });

		const result = await ship();

		expect(result.status).toBe('shipped');
		// the gates saw the generated changes while they were still uncommitted
		expect(gateViews[0]?.head).toBe(baseline);
		expect(gateViews[0]?.status).toContain('dist/');
		expect(gateViews[0]?.status).toContain('feature.md');
		// and only the verified result reached a commit and the remote
		expect(gitOut({ cwd, command: `ls-tree -r --name-only origin/${branch}` })).toContain('dist/bundle.txt');
	});

	test('integrates the remote default branch before the push, so nothing is pushed against a stale base', async () => {
		const { cwd, movedTo, ship } = setupShip({ defaultBranch: { path: 'main-one.txt', content: 'the default branch moved on\n' } });

		const result = await ship();

		const pushed = remoteTip({ cwd });

		expectDefined(movedTo);
		expect(result.status).toBe('shipped');
		expect(isAncestor({ cwd, commit: movedTo, of: pushed })).toBe(true);
	});

	test('verifies an already-up-to-date branch before pushing and creates no unnecessary merge commit', async () => {
		const { baseline, cwd, invocations, ship } = setupShip({
			gateRuns: [{ error: 'test: 1 failing', failedFamilies: ['test'], crashes: [] }, green],
			onAttempt: ({ cwd: repo }) => writeFileSync(join(repo, 'feature.md'), '# feature, repaired\n'),
		});

		const result = await ship();

		// nothing to merge is not a reason to skip verification, and a red gate
		// still earns its bounded repair
		expect(result.status).toBe('shipped');
		expect(mockShip.runGates).toHaveBeenCalledTimes(2);
		expect(invocations).toHaveLength(1);
		expect(gitOut({ cwd, command: `rev-list --merges ${baseline}..origin/${branch}` })).toBe('');
	});

	test('ships a conflict the first agent attempt settles, committing the integration itself', async () => {
		const { baseline, cwd, invocations, ship } = setupShip({
			conflict: true,
			onAttempt: ({ cwd: repo }) => {
				writeFileSync(join(repo, conflictPath), 'export const value = "feature and default";\n');
				git({ cwd: repo, command: `add ${conflictPath}` });
			},
		});

		const result = await ship();

		expect(result.status).toBe('shipped');
		expect(invocations).toHaveLength(1);
		expect(gitOut({ cwd, command: `rev-list --merges --count ${baseline}..origin/${branch}` })).toBe('1');
	});

	test('restores the pre-integration branch and blocks when the conflict allowance runs out', async () => {
		const { baseline, cwd, ship } = setupShip({ conflict: true });

		const result = await ship();

		expect(result).toEqual(
			expect.objectContaining({ status: 'blocked', reason: 'integration-conflict', failingChecks: expect.arrayContaining([conflictPath]) }),
		);
		expect(headOf({ cwd })).toBe(baseline);
		expect(gitOut({ cwd, command: 'status --porcelain' })).toBe('');
		expect(existsSync(join(cwd, '.git', 'MERGE_HEAD'))).toBe(false);
		expect(remoteTip({ cwd })).toBe('');
	});

	test('blocks and restores when the integrated tree cannot be made green', async () => {
		const { baseline, cwd, ship } = setupShip({
			defaultBranch: { path: 'main-one.txt', content: 'the default branch moved on\n' },
			gateRuns: [{ error: 'test: 3 failing', failedFamilies: ['test'], crashes: [] }],
		});

		const result = await ship();

		expect(result).toEqual(
			expect.objectContaining({ status: 'blocked', reason: 'integration-gates-failed', detail: expect.stringContaining('test: 3 failing') }),
		);
		expect(headOf({ cwd })).toBe(baseline);
		expect(gitOut({ cwd, command: 'status --porcelain' })).toBe('');
		expect(remoteTip({ cwd })).toBe('');
	});

	test('blocks before any mutation when origin cannot be fetched', async () => {
		const { baseline, cwd, mergeRequests, ship } = setupShip({ brokenOrigin: true });

		const result = await ship();

		expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: 'integration-unavailable' }));
		expect(mockShip.findPullRequest).not.toHaveBeenCalled();
		expect(mockShip.createPullRequest).not.toHaveBeenCalled();
		expect(mergeRequests).toStrictEqual([]);
		// nothing was mutated, so nothing was reset either
		expect(headOf({ cwd })).toBe(baseline);
		expect(gitOut({ cwd, command: 'status --porcelain' })).toBe('');
	});

	test('refuses to start integrating when it cannot name the commit to restore to', async () => {
		const { baseline, cwd, ship } = setupShip();

		mockShip.readGitHeadCommit.mockResolvedValue(undefined);

		const result = await ship();

		expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: 'integration-unavailable' }));
		expect(existsSync(join(cwd, '.git', 'MERGE_HEAD'))).toBe(false);
		expect(headOf({ cwd })).toBe(baseline);
	});

	test('reports restoration failure alongside the original integration failure without pushing', async () => {
		const { cwd, ship } = setupShip({
			defaultBranch: { path: 'main-one.txt', content: 'the default branch moved on\n' },
			gateRuns: [{ error: 'test: 3 failing', failedFamilies: ['test'], crashes: [] }],
			onAttempt: ({ cwd: repo }) => lockStrayDirectory({ cwd: repo }),
		});

		const result = await ship();

		// the original cause survives, the failed restoration is stated beside it,
		// and no unverified work reached the remote
		expect(result).toEqual(
			expect.objectContaining({ status: 'blocked', reason: 'integration-gates-failed', detail: expect.stringContaining('test: 3 failing') }),
		);
		expect(result.detail).toMatch(/restor/i);
		expect(remoteTip({ cwd })).toBe('');

		execSync('chmod 700 locked', { cwd, stdio: 'ignore' });
	});

	test('integrates an already-pushed branch without rewriting its remote history', async () => {
		const { cwd, publishedTip, ship } = setupShip({
			prePushed: true,
			defaultBranch: { path: 'main-one.txt', content: 'the default branch moved on\n' },
		});

		const result = await ship();

		const pushed = remoteTip({ cwd });

		expect(result.status).toBe('shipped');
		// the tip the remote already carried is still reachable, which is what a
		// fast-forward push means and a rewritten history would not
		expect(pushed).not.toBe(publishedTip);
		expect(isAncestor({ cwd, commit: publishedTip, of: pushed })).toBe(true);
	});

	test('preserves every configured pull-request merge method and the existing default', async () => {
		// One criterion covering four configurations, so each is arranged and
		// shipped in turn and the methods the forge was asked for are compared once.
		const configured = [ShipMergeMethod.Merge, ShipMergeMethod.Squash, ShipMergeMethod.Rebase];
		const omitted = resolveShipSettings({ config: { gates: { check: 'true', test: 'true', 'test-coverage': false } } });
		const asked: (ShipMergeMethod | undefined)[] = [];

		expectDefined(omitted);

		for (const mergeMethod of configured) {
			const configuredShip = setupShip({ settings: { mergeMethod } });

			await configuredShip.ship();
			asked.push(configuredShip.mergeRequests[0]?.mergeMethod);
		}

		const defaulted = setupShip({ settings: omitted });

		await defaulted.ship();
		asked.push(defaulted.mergeRequests[0]?.mergeMethod);

		expect(asked).toStrictEqual(['merge', 'squash', 'rebase', 'merge']);
	});
});
