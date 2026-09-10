import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { BranchPhase, type LightsoutConfig, ShipBlockReason, type ShipResult, ShipStatus, WorktreeOwner } from '#src/contracts/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import { readBranchState, writeBranchState } from '#src/queue/branchState/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { shipOneBranch } from '#src/queue/shipOneBranch.ts';
import { createWorktree, readWorktreeRecord, writeWorktreeRecord } from '#src/worktree/index.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipIntegrationFixture } from '#tests/helpers/shipIntegrationFixture.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

// Mocked Imports
// -------------------------
// The shared ship sequence and the gates are other modules' entry points, each
// covered by its own tests. Git is real, so what this step leaves the branch
// standing on is git's own answer.
const mockRunGates = jest.fn<(params: { cwd: string }) => Promise<GateRunResult>>();
const mockRunShip = jest.fn<(params: { cwd: string }) => Promise<ShipResult>>();
const mockTakeGateHold =
	jest.fn<
		(params: {
			cwd: string;
			config: LightsoutConfig;
			ticketRef: string | undefined;
			runId: string;
			worktreePath: string;
			reason: string;
		}) => Promise<string | undefined>
	>();

jest.mock('#src/gates/index.ts', () => ({
	runGates: (params: { cwd: string }) => mockRunGates(params),
	takeGateHold: (params: Parameters<typeof mockTakeGateHold>[0]) => mockTakeGateHold(params),
}));
jest.mock('#src/ship/index.ts', () => ({ runShip: (params: { cwd: string }) => mockRunShip(params) }));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

/** The same repository with a tracker named but no credential, so the merge tail's Done write is reached and stops at the missing key. */
const trackedConfig: LightsoutConfig = { ...config, 'ticket-tracker': { ...ticketTrackerConfigBlock, provider: 'linear' } };

const shipSettings = shipSettingsFixture();

const shippedResult: ShipResult = {
	status: ShipStatus.Shipped,
	branch: 'lo-70-drain',
	ticketRef: 'lo-70',
	prNumber: 41,
	prUrl: 'https://forge.example/pull/41',
	prTitle: 'LO-70',
	mergeCommit: '0f1e2d3c',
	mergedAt: '2026-01-01T00:00:00.000Z',
	failingChecks: [],
};

const ticketOf = ({ number }: { number: number }): TicketSummary => ({
	id: `id-${number}`,
	identifier: `LO-${number}`,
	title: `Ticket ${number}`,
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus: PlanningStatus.NotNeeded,
	worker: QueueWorker.Direct,
	status: 'Ready to implement',
	finished: false,
	unfinishedBlockers: [],
});

const author = '-c user.name=t -c user.email=t@t';

/** Passes the task straight through — what this step does under the serializer is covered in `runDrainLanes.unit.test.ts`. */
const serializeMainCheckout = <Result>({ task }: { task: () => Promise<Result> }) => task();

/** A main checkout with one ready ticket branch, committed in its own worktree. */
const setupReadyBranch = async ({ number = 70, content = 'export const value = 1;\n' }: { number?: number; content?: string } = {}) => {
	const { cwd } = setupBranchRepo();

	execSync('git config user.name t && git config user.email t@t', { cwd, stdio: 'ignore' });

	const branch = `lo-${number}-drain`;
	const worktreePath = String(await createWorktree({ cwd, branch, defaultBranch: 'main', owner: WorktreeOwner.Queue, reuseExisting: true }));

	writeRepoFile({ cwd: worktreePath, path: 'work.ts', content });
	execSync(`git add -A && git ${author} commit -qm work`, { cwd: worktreePath, stdio: 'ignore' });

	mockRunGates.mockResolvedValue({ error: undefined, failedFamilies: [], crashes: [], coordination: undefined });
	mockRunShip.mockResolvedValue(shippedResult);
	mockTakeGateHold.mockResolvedValue(undefined);

	const outcome: TicketRunOutcome = { ticket: ticketOf({ number }), branch, worktreePath, ready: true };

	return { cwd, outcome };
};

/** Move the remote's default branch on, so the shared ship sequence has something to integrate. */
const advanceOrigin = ({ cwd, file, content }: { cwd: string; file: string; content: string }) => {
	writeRepoFile({ cwd, path: file, content });
	execSync(`git add -A && git ${author} commit -qm main-moved && git push -q origin main`, { cwd, stdio: 'ignore' });
};

/** The merge lane's call: the same task every time, plus the harness bundle the shared ship sequence recovers with. */
const ship = async ({
	cwd,
	outcome,
	shipConfig = config,
	serialize = serializeMainCheckout,
	runId = 'drain-41',
	onProgress,
}: {
	cwd: string;
	outcome: TicketRunOutcome;
	shipConfig?: LightsoutConfig;
	serialize?: <Result>(params: { task: () => Promise<Result> }) => Promise<Result>;
	runId?: string;
	onProgress?: (message: string) => void;
}) =>
	shipOneBranch({
		cwd,
		config: shipConfig,
		shipSettings,
		integration: shipIntegrationFixture(),
		defaultBranch: 'main',
		env: {},
		outcome,
		runId,
		serializeMainCheckout: serialize,
		onProgress,
	});

/** A ship that stopped because the shared gate reservation was never acquired — the one block a hold is taken on. */
const gatesUnavailableResult: ShipResult = {
	status: ShipStatus.Blocked,
	branch: 'lo-70-drain',
	reason: ShipBlockReason.IntegrationGatesUnavailable,
	detail: 'the gates never got the machine within 30m: run drain-8 in /tmp/lo-71-other, held for 31m',
	failingChecks: [],
};

/** The commit the branch is standing on — the evidence that nothing here moved it. */
const headOf = ({ cwd }: { cwd: string }) => execSync('git rev-parse HEAD', { cwd }).toString().trim();

/** A main-checkout serializer that records whether the worktree was still there when the task it wraps began. */
const recordingSerializer =
	({ calls, worktreePath }: { calls: boolean[]; worktreePath: string }) =>
	async <Result>({ task }: { task: () => Promise<Result> }): Promise<Result> => {
		calls.push(existsSync(worktreePath));

		return task();
	};

describe('shipOneBranch', () => {
	test('answers with the outcome still ready when the merge landed, which is how the drain knows to re-read the tracker', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		const shipped = await ship({ cwd, outcome });

		// `ready` alone is not the whole claim: a parked branch carries the reason.
		expect(shipped).toEqual(expect.objectContaining({ branch: 'lo-70-drain', ready: true }));
		expect(shipped.error).toBe(undefined);
	});

	test('merges and drops the worktree, running no fetch, rebase or gates of its own', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		advanceOrigin({ cwd, file: 'other.ts', content: 'export const other = 2;\n' });

		const shipped = await ship({ cwd, outcome });

		// integrating the moved default branch and re-running the gates belong to
		// the shared ship sequence now, for every caller rather than this one
		expect(shipped).toStrictEqual(outcome);
		expect(mockRunGates).not.toHaveBeenCalled();
		expect(mockRunShip).toHaveBeenCalledTimes(1);
		expect(existsSync(outcome.worktreePath)).toBe(false);
	});

	test('parks a blocked ship carrying the forge’s own reason and detail, and keeps the worktree', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		mockRunShip.mockResolvedValue({ status: ShipStatus.Blocked, reason: ShipBlockReason.ChecksFailed, detail: 'checks finished red', failingChecks: ['unit'] });

		const shipped = await ship({ cwd, outcome });

		expect(shipped).toEqual(expect.objectContaining({ ready: false, error: 'checks-failed: checks finished red' }));
		expect(existsSync(outcome.worktreePath)).toBe(true);
	});

	test('records the branch merged, so no later run offers it to a worker or merges it twice', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		await ship({ cwd, outcome });

		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toEqual(expect.objectContaining({ phase: BranchPhase.Merged }));
	});

	test('leaves a branch parked by an unsettled integration recorded ready, so the next run re-ships it rather than re-doing it', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		await writeBranchState({ cwd, branch: 'lo-70-drain', phase: BranchPhase.Ready });
		mockRunShip.mockResolvedValue({ status: ShipStatus.Blocked, reason: ShipBlockReason.IntegrationConflict, detail: 'unmerged', failingChecks: [] });

		const shipped = await ship({ cwd, outcome });

		// The work is finished; only the merge failed.
		expect(shipped.ready).toBe(false);
		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toEqual(expect.objectContaining({ phase: BranchPhase.Ready }));
	});

	test('announces the ticket it could not merge, so a parked branch is visible without reading the report', async () => {
		const { cwd, outcome } = await setupReadyBranch();
		const progress: string[] = [];

		mockRunShip.mockResolvedValue({ status: ShipStatus.Blocked, reason: ShipBlockReason.IntegrationGatesFailed, detail: 'tsc: 3 errors', failingChecks: [] });
		await ship({ cwd, outcome, onProgress: (message) => progress.push(message) });

		expect(progress).toEqual([
			expect.stringContaining('merging lo-70-drain'),
			expect.stringContaining('LO-70 · not shipped: integration-gates-failed: tsc: 3 errors'),
		]);
	});

	test("parks on the shared sequence's integration reason instead of rebasing first", async () => {
		const { cwd, outcome } = await setupReadyBranch();

		advanceOrigin({ cwd, file: 'work.ts', content: 'export const value = 99;\n' });
		const beforeShipping = headOf({ cwd: outcome.worktreePath });
		mockRunShip.mockResolvedValue({
			status: ShipStatus.Blocked,
			reason: ShipBlockReason.IntegrationConflict,
			detail: 'merging origin/main left work.ts unmerged',
			failingChecks: ['work.ts'],
		});

		const parked = await ship({ cwd, outcome });

		// A rebase of the queue's own would have parked before the ship ran, so a
		// ship that ran at all is what says the rebase is gone.
		expect(parked).toEqual(expect.objectContaining({ ready: false, error: 'integration-conflict: merging origin/main left work.ts unmerged' }));
		expect(mockRunShip).toHaveBeenCalledTimes(1);
		expect(headOf({ cwd: outcome.worktreePath })).toBe(beforeShipping);
	});

	test('keeps the merge tail intact now that integration moved into the shared sequence', async () => {
		const { cwd, outcome } = await setupReadyBranch();
		const serialized: boolean[] = [];

		const shipped = await ship({
			cwd,
			outcome,
			shipConfig: trackedConfig,
			serialize: recordingSerializer({ calls: serialized, worktreePath: outcome.worktreePath }),
		});

		// The reconciliation sentence names the shipped ticket, which is what says
		// the Done write was still reached.
		expect(shipped).toEqual({ ...outcome, reconciliationFailure: expect.stringContaining('lo-70 shipped') });
		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toEqual(expect.objectContaining({ phase: BranchPhase.Merged }));
		// The removal ran inside the serializer, on a worktree that was still there when it took the chain.
		expect(serialized).toEqual([true]);
		expect(existsSync(outcome.worktreePath)).toBe(false);
	});

	test('takes a gate hold when the shipping gates never got the machine', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		mockRunShip.mockResolvedValue(gatesUnavailableResult);

		const parked = await ship({ cwd, outcome, runId: 'drain-41' });

		// The reason a human reads names the machine, not gate output that nothing
		// produced — and the hold is what stops the next drain picking it straight
		// back up.
		expect(parked).toEqual(expect.objectContaining({ ready: false, error: gatesUnavailableResult.detail }));
		expect(mockTakeGateHold).toHaveBeenCalledWith(
			expect.objectContaining({ ticketRef: 'LO-70', runId: 'drain-41', worktreePath: outcome.worktreePath, reason: gatesUnavailableResult.detail }),
		);
		// Parked, never merged: the worktree and its commits are exactly where the run left them.
		expect(existsSync(outcome.worktreePath)).toBe(true);
	});

	test('reports a refused label write beside the park reason, so a hold the tracker would not record is still visible', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		mockRunShip.mockResolvedValue(gatesUnavailableResult);
		mockTakeGateHold.mockResolvedValue('the tracker refused the queue-blocked-gate-timed-out label: 403 forbidden');

		const parked = await ship({ cwd, outcome });

		expect(parked).toEqual(
			expect.objectContaining({ ready: false, error: expect.stringContaining('the tracker refused the queue-blocked-gate-timed-out label') }),
		);
	});

	test('takes no hold when the ship was blocked for any other reason, so an ordinary park is never turned into one only a human can release', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		mockRunShip.mockResolvedValue({
			status: ShipStatus.Blocked,
			branch: 'lo-70-drain',
			reason: ShipBlockReason.IntegrationGatesFailed,
			detail: 'tsc: 3 errors',
			failingChecks: [],
		});

		const parked = await ship({ cwd, outcome });

		expect(parked).toEqual(expect.objectContaining({ ready: false, error: 'integration-gates-failed: tsc: 3 errors' }));
		expect(mockTakeGateHold).not.toHaveBeenCalled();
	});

	test('leaves the branch recorded merged and no worktree record behind after a confirmed merge', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		await writeWorktreeRecord({ cwd, branch: outcome.branch, owner: WorktreeOwner.Queue, worktreePath: outcome.worktreePath });

		const shipped = await ship({ cwd, outcome });

		// The record outlives the tree only when the removal failed, so a merged
		// branch with no record left is what says the tree really came down.
		expect(shipped.ready).toBe(true);
		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toEqual(expect.objectContaining({ phase: BranchPhase.Merged }));
		expect(await readWorktreeRecord({ cwd, branch: 'lo-70-drain' })).toBe(undefined);
	});
});
