import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { BranchPhase, type LightsoutConfig, ShipBlockReason, type ShipResult, ShipStatus } from '#src/contracts/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import { readBranchState, writeBranchState } from '#src/queue/branchState/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { createTicketWorktree } from '#src/queue/createTicketWorktree.ts';
import { shipOneBranch } from '#src/queue/shipOneBranch.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

// Mocked Imports
// -------------------------
// The gates and the forge are other modules' entry points, each covered by its
// own tests. Git is real, because the rebase is the whole mechanism this step
// exists for — a stubbed one would prove nothing about conflicts.
const mockRunGates = jest.fn<(params: { cwd: string }) => Promise<GateRunResult>>();
const mockRunShip = jest.fn<(params: { cwd: string }) => Promise<ShipResult>>();

jest.mock('#src/gates/index.ts', () => ({ runGates: (params: { cwd: string }) => mockRunGates(params) }));
jest.mock('#src/ship/index.ts', () => ({ runShip: (params: { cwd: string }) => mockRunShip(params) }));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

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
	unfinishedBlockers: [],
});

const author = '-c user.name=t -c user.email=t@t';

/** Passes the task straight through: what this step does under the serializer is its caller's concern, covered in `runDrainLanes.unit.test.ts`. */
const serializeMainCheckout = <Result>({ task }: { task: () => Promise<Result> }) => task();

/** A main checkout with one ready ticket branch, committed in its own worktree. */
const setupReadyBranch = async ({ number = 70, content = 'export const value = 1;\n' }: { number?: number; content?: string } = {}) => {
	const { cwd } = setupBranchRepo();

	execSync('git config user.name t && git config user.email t@t', { cwd, stdio: 'ignore' });

	const branch = `lo-${number}-drain`;
	const worktreePath = String(await createTicketWorktree({ cwd, branch, defaultBranch: 'main' }));

	writeRepoFile({ cwd: worktreePath, path: 'work.ts', content });
	execSync(`git add -A && git ${author} commit -qm work`, { cwd: worktreePath, stdio: 'ignore' });

	mockRunGates.mockResolvedValue({ error: undefined, failedFamilies: [], crashes: [] });
	mockRunShip.mockResolvedValue(shippedResult);

	const outcome: TicketRunOutcome = { ticket: ticketOf({ number }), branch, worktreePath, ready: true };

	return { cwd, outcome };
};

/** Move the remote's default branch on, so a rebase has something to move onto. */
const advanceOrigin = ({ cwd, file, content }: { cwd: string; file: string; content: string }) => {
	writeRepoFile({ cwd, path: file, content });
	execSync(`git add -A && git ${author} commit -qm main-moved && git push -q origin main`, { cwd, stdio: 'ignore' });
};

const ship = async ({ cwd, outcome, onProgress }: { cwd: string; outcome: TicketRunOutcome; onProgress?: (message: string) => void }) =>
	shipOneBranch({ cwd, config, shipSettings, defaultBranch: 'main', env: {}, outcome, serializeMainCheckout, onProgress });

describe('shipOneBranch', () => {
	test('answers with the outcome still ready when the merge landed, which is how the drain knows to re-read the tracker', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		const shipped = await ship({ cwd, outcome });

		expect(shipped).toEqual(expect.objectContaining({ branch: 'lo-70-drain', ready: true }));
		// `ready` alone is not the whole claim: a parked branch carries the reason,
		// so an outcome with no `error` is what says the merge found no trouble.
		expect(shipped.error).toBe(undefined);
	});

	test('rebases, re-runs the gates, merges, and drops the worktree once the ticket has shipped', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		const shipped = await ship({ cwd, outcome });

		expect(shipped).toStrictEqual(outcome);
		expect(mockRunGates).toHaveBeenCalledWith(expect.objectContaining({ cwd: outcome.worktreePath, coverage: true }));
		expect(existsSync(outcome.worktreePath)).toBe(false);
	});

	test('re-runs the gates because the rebase moved the branch onto commits it has never been tested against', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		advanceOrigin({ cwd, file: 'other.ts', content: 'export const other = 2;\n' });
		await ship({ cwd, outcome });

		expect(mockRunGates).toHaveBeenCalledTimes(1);
		expect(mockRunShip).toHaveBeenCalledTimes(1);
	});

	test('parks a branch that will not rebase, leaving its worktree for a human and never reaching the forge', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		advanceOrigin({ cwd, file: 'work.ts', content: 'export const value = 99;\n' });

		const shipped = await ship({ cwd, outcome });

		expect(shipped).toEqual(expect.objectContaining({ ready: false, error: expect.stringContaining('would not rebase onto origin/main') }));
		expect(mockRunShip).not.toHaveBeenCalled();
		expect(existsSync(outcome.worktreePath)).toBe(true);
	});

	test('parks a branch whose gates came back red after the rebase, rather than merging what nothing vouches for', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		mockRunGates.mockResolvedValue({ error: 'tsc: 3 errors', failedFamilies: ['check'], crashes: [] });

		const shipped = await ship({ cwd, outcome });

		expect(shipped).toEqual(expect.objectContaining({ ready: false, error: 'tsc: 3 errors' }));
		expect(mockRunShip).not.toHaveBeenCalled();
	});

	test('parks a blocked ship carrying the forge’s own reason and detail, and keeps the worktree', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		mockRunShip.mockResolvedValue({
			status: ShipStatus.Blocked,
			reason: ShipBlockReason.ChecksFailed,
			detail: 'one or more checks finished red',
			failingChecks: ['unit'],
		});

		const shipped = await ship({ cwd, outcome });

		expect(shipped).toEqual(expect.objectContaining({ ready: false, error: 'checks-failed: one or more checks finished red' }));
		expect(existsSync(outcome.worktreePath)).toBe(true);
	});

	test('parks a ticket whose worktree was deleted between the drain and the ship, rather than throwing on the missing directory', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		rmSync(outcome.worktreePath, { recursive: true, force: true });

		const shipped = await ship({ cwd, outcome });

		expect(shipped).toEqual(expect.objectContaining({ ready: false, error: 'git could not fetch origin: git did not answer' }));
		expect(mockRunGates).not.toHaveBeenCalled();
		expect(mockRunShip).not.toHaveBeenCalled();
	});

	test('records the branch merged, so no later run offers it to a worker or merges it twice', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		await ship({ cwd, outcome });

		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toEqual(expect.objectContaining({ phase: BranchPhase.Merged }));
	});

	test('leaves a branch parked by a rebase conflict recorded ready, so the next run re-ships it rather than re-doing it', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		await writeBranchState({ cwd, branch: 'lo-70-drain', phase: BranchPhase.Ready });
		advanceOrigin({ cwd, file: 'work.ts', content: 'export const value = 99;\n' });

		const shipped = await ship({ cwd, outcome });

		// The work is finished; only the merge failed.
		expect(shipped.ready).toBe(false);
		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toEqual(expect.objectContaining({ phase: BranchPhase.Ready }));
	});

	test('announces the ticket it could not merge, so a parked branch is visible without reading the report', async () => {
		const { cwd, outcome } = await setupReadyBranch();
		const progress: string[] = [];

		mockRunGates.mockResolvedValue({ error: 'tsc: 3 errors', failedFamilies: ['check'], crashes: [] });
		await ship({ cwd, outcome, onProgress: (message) => progress.push(message) });

		expect(progress).toEqual([expect.stringContaining('rebasing lo-70-drain'), expect.stringContaining('LO-70 · not shipped: tsc: 3 errors')]);
	});

	test('merges a branch that rebases onto a main carrying a generated file the branch never touched', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		// Stands in for the pre-ship commit an earlier merge would have produced:
		// build output on main that this branch carries no copy of.
		advanceOrigin({ cwd, file: 'plugin/dist/cli.mjs', content: 'export const built = 1;\n' });

		const shipped = await ship({ cwd, outcome });

		expect(shipped).toEqual(expect.objectContaining({ branch: 'lo-70-drain', ready: true }));
		expect(shipped.error).toBe(undefined);
		expect(mockRunShip).toHaveBeenCalledTimes(1);
	});
});
