import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
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

const { branch, ciFailure, greenChecks, mergedCommit, missingChecks, redChecks, staleBase } = shipScenarioFixtures;
const { advanceDefaultBranch, gitOut, remoteTip, writeHookScript } = shipScenarioGit;

// What the shared sequence spends its three complete attempts on: a check list
// that never appeared, a CI failure it may repair, and a merge the forge refused
// on a newer base. What one attempt does to the branch is the sibling
// integration file's subject.
describe('runShip', () => {
	test('blocks missing CI and explains the explicit opt-out', async () => {
		const { mergeRequests, ship } = setupShip({ checkRuns: [missingChecks] });

		const result = await ship();

		expect(result).toEqual(
			expect.objectContaining({
				status: 'blocked',
				reason: 'checks-missing',
				detail: expect.stringContaining('set ship.allow-no-ci to true in lightsout.config.json, commit the change, and rerun ship'),
			}),
		);
		expect(mergeRequests).toStrictEqual([]);
	});

	test('repairs a demonstrated CI defect and waits for the repaired commit to pass', async () => {
		const { evidenceReads, expectedHeads, invocations, mergeRequests, ship } = setupShip({
			checkRuns: [redChecks, greenChecks],
			evidenceRuns: [[ciFailure]],
			onAttempt: ({ cwd: repo }) => writeFileSync(join(repo, 'feature.md'), '# feature, fixed for the runner\n'),
		});

		const result = await ship();

		expect(result.status).toBe('shipped');
		// the evidence was asked for by the commit that actually failed, and the
		// repaired candidate is a different commit whose own checks were waited on
		expect(evidenceReads[0]).toEqual(expect.objectContaining({ commit: expectedHeads[0], failingChecks: ['unit'] }));
		expect(invocations[0]?.prompt).toContain('AssertionError: expected 3 to be 4');
		expect(expectedHeads).toHaveLength(2);
		expect(expectedHeads[1]).not.toBe(expectedHeads[0]);
		expect(mergeRequests.map((request) => request.expectedHead)).toStrictEqual([expectedHeads[1]]);
	});

	test('blocks CI failures that cannot be repaired within the agreed scope', async () => {
		const { invocations, mergeRequests, ship } = setupShip({ checkRuns: [redChecks], evidenceRuns: [undefined] });

		const result = await ship();

		expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: 'checks-failed', failingChecks: ['unit'] }));
		expect(result.detail).toMatch(/check/i);
		// no evidence means no candidate defect, so nothing is guessed at and
		// nothing is offered for merge
		expect(invocations).toStrictEqual([]);
		expect(mergeRequests).toStrictEqual([]);
	});

	test('shares the three-attempt budget across stale-base and CI recovery', async () => {
		const { cwd, expectedHeads, mergeRequests, ship } = setupShip({
			checkRuns: [greenChecks, redChecks, greenChecks],
			mergeRuns: [staleBase],
			evidenceRuns: [[ciFailure]],
			onAttempt: ({ cwd: repo, attempt }) => writeFileSync(join(repo, `repair-${attempt}.md`), 'repaired\n'),
		});

		const result = await ship();

		// three complete attempts and no fourth, whichever obstacle each one met
		expect(expectedHeads).toHaveLength(3);
		expect(mergeRequests).toHaveLength(2);
		expect(result).toEqual(
			expect.objectContaining({ status: 'blocked', reason: 'merge-rejected', detail: expect.stringContaining('Base branch was modified') }),
		);
		expect(remoteTip({ cwd })).not.toBe('');
	});

	test('never substitutes local or previous-commit success for passing current CI', async () => {
		const { mergeRequests, ship } = setupShip({
			checkRuns: [greenChecks, redChecks],
			mergeRuns: [staleBase],
			evidenceRuns: [[ciFailure]],
			onAttempt: ({ cwd: repo, attempt }) => writeFileSync(join(repo, `repair-${attempt}.md`), 'repaired\n'),
		});

		const result = await ship();

		// the first candidate's checks were green and its merge was refused; every
		// candidate after it went red, and a green reading on a commit that is no
		// longer the head buys nothing
		expect(mergeRequests).toHaveLength(1);
		expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: 'checks-failed' }));
	});
	test('recovers from two stale-base refusals and ships on its third attempt', async () => {
		const { expectedHeads, mergeRequests, progress, ship } = setupShip({ mergeRuns: [staleBase, staleBase, mergedCommit] });

		const result = await ship();

		expect(result).toEqual(expect.objectContaining({ status: 'shipped', mergeCommit: mergedCommit }));
		expect(mergeRequests).toHaveLength(3);
		expect(expectedHeads).toHaveLength(3);
		// the local cleanup belongs to the confirmed merge, so it runs once at the
		// end rather than once per attempt
		expect(progress.filter((line) => line.includes('sync: git checkout main'))).toHaveLength(1);
	});

	test('stops after three complete attempts and preserves published work', async () => {
		const { cwd, expectedHeads, mergeRequests, ship } = setupShip({ mergeRuns: [staleBase] });

		const result = await ship();

		expect(result).toEqual(
			expect.objectContaining({ status: 'blocked', reason: 'merge-rejected', detail: expect.stringContaining('Base branch was modified') }),
		);
		expect(mergeRequests).toHaveLength(3);
		expect(expectedHeads).toHaveLength(3);
		expect(mockShip.runGates).toHaveBeenCalledTimes(3);
		expect(remoteTip({ cwd })).not.toBe('');
	});

	test('attempts shipping the tested candidate without a preemptive freshness restart', async () => {
		const { mergeRequests, ship } = setupShip({
			onGate: ({ origin, run }) => {
				if (run === 1) {
					advanceDefaultBranch({ origin, path: 'main-late.txt', content: 'the default branch moved while the checks ran\n' });
				}
			},
		});

		const result = await ship();

		// the candidate that passed is the candidate that was offered: a base that
		// moved during verification is not by itself a reason to start over
		expect(result.status).toBe('shipped');
		expect(mockShip.runGates).toHaveBeenCalledTimes(1);
		expect(mergeRequests).toHaveLength(1);
	});

	test('stops immediately when a merge requires human action', async () => {
		const { expectedHeads, mergeRequests, ship } = setupShip({
			mergeRuns: [{ stderr: 'Pull request is not mergeable: review required by a code owner' }],
		});

		const result = await ship();

		expect(result).toEqual(
			expect.objectContaining({ status: 'blocked', reason: 'merge-rejected', detail: expect.stringContaining('review required by a code owner') }),
		);
		// one attempt, and the retry allowance untouched
		expect(mergeRequests).toHaveLength(1);
		expect(expectedHeads).toHaveLength(1);
	});

	test('confirms a merge before considering an automatic retry', async () => {
		// The forge boundary answers with the commit its own read-back confirmed,
		// which is what a merge command that failed only on local cleanup produces.
		const { mergeRequests, ship } = setupShip({ mergeRuns: [mergedCommit] });

		const result = await ship();

		expect(result).toEqual(expect.objectContaining({ status: 'shipped', mergeCommit: mergedCommit }));
		expect(mergeRequests).toHaveLength(1);
		expect(mockShip.runGates).toHaveBeenCalledTimes(1);
	});

	test('rebuilds and versions against the refreshed source on every retry', async () => {
		const logPath = join(mkdtempSync(join(tmpdir(), 'lightsout-preship-')), 'preship.log');
		const hook = writeHookScript({
			body: [
				"const { appendFileSync, existsSync } = require('node:fs');",
				`appendFileSync(${JSON.stringify(logPath)}, (process.env.LIGHTSOUT_SHIP_BASE_COMMIT ?? 'none') + ' ' + existsSync('main-two.txt') + '\\n');`,
				'',
			].join('\n'),
		});
		const { cwd, ship } = setupShip({
			mergeRuns: [staleBase, mergedCommit],
			settings: { preShip: `node ${hook}` },
			onMerge: ({ origin, request }) => {
				if (request === 1) {
					advanceDefaultBranch({ origin, path: 'main-two.txt', content: 'newer source on the default branch\n' });
				}
			},
		});

		const result = await ship();

		const prepared = readFileSync(logPath, 'utf8').trim().split('\n');

		expect(result.status).toBe('shipped');
		// the retry prepared against a different pinned base, with the newer source
		// already merged in, and pushed that rebuilt candidate
		expect(prepared).toHaveLength(2);
		expect(prepared[0]).toContain(' false');
		expect(prepared[1]).toContain(' true');
		expect(prepared[1]?.split(' ')[0]).not.toBe(prepared[0]?.split(' ')[0]);
		expect(gitOut({ cwd, command: `ls-tree -r --name-only origin/${branch}` })).toContain('main-two.txt');
	});
});
