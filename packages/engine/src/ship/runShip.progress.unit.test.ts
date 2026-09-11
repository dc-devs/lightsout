import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { ShippingProgress } from '#src/contracts/index.ts';
import { mockShip } from '#tests/helpers/mockShip.ts';
import { setupShipScenario as setupShip } from '#tests/helpers/setupShipScenario.ts';
import { shipScenarioFixtures } from '#tests/helpers/shipScenarioFixtures.ts';

// Mocked Imports
// -------------------------
// Git is real throughout, as in the sibling scenario files, because the
// progress record is filed inside the real checkout the ship stands on. What is
// stubbed is everything that would leave the machine or take half an hour: the
// repository's own gates, the forge, and the check wait.
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

const { redChecks, staleBase } = shipScenarioFixtures;

/** The progress folder inside the checkout's ship folder, where a branch's record is filed. */
const progressDir = ({ cwd }: { cwd: string }) => join(cwd, '.lightsout', 'ship', 'progress');

/** The scenario branch's record, read off disk and held to its contract. */
const readRecord = ({ cwd }: { cwd: string }): ShippingProgress =>
	ShippingProgress.parse(JSON.parse(readFileSync(join(progressDir({ cwd }), 'lo-89-ship.json'), 'utf8')));

/** A green ship whose checkout holds a regular file where the progress folder would be. */
const setupUnwritableProgress = () => {
	const scenario = setupShip();

	mkdirSync(join(scenario.cwd, '.lightsout', 'ship'), { recursive: true });
	writeFileSync(progressDir({ cwd: scenario.cwd }), 'a file where the progress folder would be\n');

	return scenario;
};

// What the ship sequence records about its own steps while it runs. What each
// step does to the branch is the sibling scenario files' subject.
describe('runShip', () => {
	test("a shipped branch leaves a record with all six steps passed, its end stamped, and the sink's last line", async () => {
		const { cwd, progress, ship } = setupShip();

		const result = await ship();
		const record = readRecord({ cwd });

		expect(result.status).toBe('shipped');
		expect(record).toEqual(
			expect.objectContaining({ branch: 'lo-89-ship', attempt: 1, maxAttempts: 3, endedAt: expect.any(String), lastProgress: progress.at(-1) }),
		);
		expect(record.steps.map(({ id, status }) => ({ id, status }))).toStrictEqual([
			{ id: 'integrate', status: 'passed' },
			{ id: 'push', status: 'passed' },
			{ id: 'pull-request', status: 'passed' },
			{ id: 'checks', status: 'passed' },
			{ id: 'merge', status: 'passed' },
			{ id: 'sync', status: 'passed' },
		]);
	});

	test('a ship stopped by red checks marks checks failed and leaves merge and sync not reached', async () => {
		const { cwd, ship } = setupShip({ checkRuns: [redChecks], evidenceRuns: [undefined] });

		const result = await ship();
		const record = readRecord({ cwd });

		expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: 'checks-failed' }));
		expect(record.endedAt).toEqual(expect.any(String));
		expect(record.steps.map(({ id, status }) => ({ id, status }))).toStrictEqual([
			{ id: 'integrate', status: 'passed' },
			{ id: 'push', status: 'passed' },
			{ id: 'pull-request', status: 'passed' },
			{ id: 'checks', status: 'failed' },
			{ id: 'merge', status: 'pending' },
			{ id: 'sync', status: 'pending' },
		]);
	});

	test('a ship stopped while integrating marks integrate failed and leaves every later step not reached', async () => {
		const { cwd, ship } = setupShip({ brokenOrigin: true });

		const result = await ship();
		const record = readRecord({ cwd });

		expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: 'integration-unavailable' }));
		expect(record).toEqual(expect.objectContaining({ attempt: 1, endedAt: expect.any(String) }));
		expect(record.steps.map(({ id, status }) => ({ id, status }))).toStrictEqual([
			{ id: 'integrate', status: 'failed' },
			{ id: 'push', status: 'pending' },
			{ id: 'pull-request', status: 'pending' },
			{ id: 'checks', status: 'pending' },
			{ id: 'merge', status: 'pending' },
			{ id: 'sync', status: 'pending' },
		]);
	});

	test("a merge refused for a stale base is recorded as attempt 2, with that attempt's steps run again", async () => {
		const { cwd, ship } = setupShip({ mergeRuns: [staleBase, '0f1e2d3c'] });

		const result = await ship();
		const record = readRecord({ cwd });

		expect(result.status).toBe('shipped');
		expect(record.attempt).toBe(2);
		expect(record.steps.map(({ id, status }) => ({ id, status }))).toStrictEqual([
			{ id: 'integrate', status: 'passed' },
			{ id: 'push', status: 'passed' },
			{ id: 'pull-request', status: 'passed' },
			{ id: 'checks', status: 'passed' },
			{ id: 'merge', status: 'passed' },
			{ id: 'sync', status: 'passed' },
		]);
	});

	test('a blocked precondition writes no progress record, because no ship step ran', async () => {
		const { cwd, ship } = setupShip({ staged: { 'feature.md': '# feature, edited and staged\n' } });

		const result = await ship();

		expect(result).toEqual(expect.objectContaining({ status: 'blocked', reason: 'dirty-tree' }));
		expect(existsSync(progressDir({ cwd }))).toBe(false);
	});

	test('a progress record that cannot be written changes neither the result nor the progress lines', async () => {
		const { progress, ship } = setupUnwritableProgress();

		const result = await ship();

		expect(result).toEqual(
			expect.objectContaining({
				status: 'shipped',
				branch: 'lo-89-ship',
				ticketRef: 'lo-89',
				prNumber: 41,
				prUrl: 'https://forge.example/acme/repo/pull/41',
				mergeCommit: '0f1e2d3c',
			}),
		);
		expect(progress.filter((line) => line.includes(join('ship', 'progress')))).toStrictEqual([]);
		expect(progress.at(-1)).toMatch(/^ship result: /);
	});
});
