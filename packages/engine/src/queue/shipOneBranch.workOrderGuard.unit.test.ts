import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import {
	BranchPhase,
	type LightsoutConfig,
	PlanProgress,
	ShipBlockReason,
	type ShipResult,
	ShipStatus,
	WorkOrderEventKind,
	WorkOrderMode,
	type WorkOrderState,
	WorktreeOwner,
} from '#src/contracts/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import { readBranchState, writeBranchState } from '#src/queue/branchState/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WorkOrderRunOutcome } from '#src/queue/common/types/WorkOrderRunOutcome.ts';
import { shipOneBranch } from '#src/queue/shipOneBranch.ts';
import type { ShipWorkOrderGuard } from '#src/ship/index.ts';
import { updateLocalWorkOrderState } from '#src/workOrder/index.ts';
import { createWorktree } from '#src/worktree/index.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipIntegrationFixture } from '#tests/helpers/shipIntegrationFixture.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

/**
 * What the merge lane does with a branch whose ticket record does not authorize
 * shipping it.
 *
 * A sibling of `shipOneBranch.unit.test.ts` rather than more cases in it: every
 * case here turns on a ticket record and on the third answer — left open — while
 * that file's cases are about the merge itself and about what a park leaves
 * behind.
 */

// Mocked Imports
// -------------------------
// The shared ship sequence and the gates are other modules' entry points, each
// covered by its own tests. Git is real, so what this step leaves the branch
// standing on is git's own answer.
const mockRunGates = jest.fn<(params: { cwd: string }) => Promise<GateRunResult>>();
const mockRunShip = jest.fn<(params: { cwd: string; workOrderGuard: ShipWorkOrderGuard }) => Promise<ShipResult>>();
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
jest.mock('#src/ship/index.ts', () => ({ runShip: (params: Parameters<typeof mockRunShip>[0]) => mockRunShip(params) }));
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
	url: `https://linear.app/lightsout/issue/LO-${number}`,
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
const setupReadyBranch = async ({ number = 70 }: { number?: number } = {}) => {
	const { cwd } = setupBranchRepo();

	execSync('git config user.name t && git config user.email t@t', { cwd, stdio: 'ignore' });

	const branch = `lo-${number}-drain`;

	// The branch's phase is recorded in the work order whose record stores it, so
	// the work order comes before the tree.
	seedWorkOrderRecord({ cwd, name: branch, ticketRef: `lo-${number}` });

	const worktreePath = String(await createWorktree({ cwd, branch, startPoint: 'origin/main', owner: WorktreeOwner.Queue, reuseExisting: true }));

	writeRepoFile({ cwd: worktreePath, path: 'work.ts', content: 'export const value = 1;\n' });
	execSync(`git add -A && git ${author} commit -qm work`, { cwd: worktreePath, stdio: 'ignore' });

	mockRunGates.mockResolvedValue({ error: undefined, failedFamilies: [], crashes: [], coordination: undefined });
	mockRunShip.mockResolvedValue(shippedResult);
	mockTakeGateHold.mockResolvedValue(undefined);

	const outcome: WorkOrderRunOutcome = { ticket: ticketOf({ number }), name: branch, branch, worktreePath, ready: true };

	return { cwd, outcome };
};

/** The merge lane's call: the same task every time, plus the harness bundle the shared ship sequence recovers with. */
const ship = async ({ cwd, outcome }: { cwd: string; outcome: WorkOrderRunOutcome }) =>
	shipOneBranch({
		cwd,
		config,
		shipSettings,
		integration: shipIntegrationFixture(),
		defaultBranch: 'main',
		env: {},
		outcome,
		runId: 'drain-41',
		serializeMainCheckout,
	});

/**
 * A ticket record whose one plan is implemented and whose merge nothing has
 * approved: a multiple-plan work order carrying no ship request.
 */
const unauthorizedRecordOf = ({ branch }: { branch: string }): WorkOrderState => ({
	schemaVersion: 1,
	name: branch,
	ticketRef: 'LO-70',
	branch,
	mode: WorkOrderMode.MultiplePlan,
	plans: [{ id: '001-drain-work', title: 'Drain work', progress: PlanProgress.Implemented, createdAt: '2026-01-01T00:00:00.000Z' }],
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: WorkOrderEventKind.PlanAdded, detail: 'added plan 001-drain-work' }],
});

/**
 * The same ready branch, plus a ticket record that does not authorize shipping
 * it — and a shared ship sequence that asks the guard it was handed, which is
 * what the real one does before anything is pushed.
 */
const setupUnauthorizedTicket = async () => {
	const { cwd, outcome } = await setupReadyBranch();

	await updateLocalWorkOrderState({ cwd, name: outcome.branch, change: () => unauthorizedRecordOf({ branch: outcome.branch }) });
	mockRunShip.mockImplementation(async ({ cwd: shipCwd, workOrderGuard }) => {
		const refusal = await workOrderGuard.authorize({ cwd: shipCwd, branch: outcome.branch });

		return refusal === undefined
			? shippedResult
			: { status: ShipStatus.Blocked, branch: outcome.branch, reason: ShipBlockReason.WorkOrderNotAuthorized, detail: refusal, failingChecks: [] };
	});

	return { cwd, outcome };
};

describe('shipOneBranch', () => {
	test('leaves a branch its ticket record does not authorize open, keeping the worktree', async () => {
		const { cwd, outcome } = await setupUnauthorizedTicket();

		const left = await ship({ cwd, outcome });

		// The record's own sentence is what says the merge lane read the record
		// rather than merging a branch nothing approved. It sits in `open` rather
		// than `error`: the work is fine and the ticket is simply not finished.
		expect(left).toEqual(expect.objectContaining({ ready: false, open: expect.stringMatching(/carries no ship request/) }));
		expect(left.error).toBe(undefined);
		// Nothing merged, and the tree the work is in is still standing.
		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toEqual(expect.objectContaining({ phase: BranchPhase.Open }));
		expect(existsSync(outcome.worktreePath)).toBe(true);
	});

	test('shipOneBranch: a ticket the ship check refuses is recorded open instead of ready', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		await writeBranchState({ cwd, branch: 'lo-70-drain', phase: BranchPhase.Ready });
		mockRunShip.mockResolvedValue({
			status: ShipStatus.Blocked,
			branch: 'lo-70-drain',
			reason: ShipBlockReason.WorkOrderNotAuthorized,
			detail: 'LO-70 carries no ship request, so nothing has approved merging it',
			failingChecks: [],
		});

		const left = await ship({ cwd, outcome });

		// Not a park: the reason sits in `open`, so the parked label, the exit code
		// and the board all read it as waiting on a human, not as failed work.
		expect(left).toEqual(expect.objectContaining({ ready: false, open: 'LO-70 carries no ship request, so nothing has approved merging it' }));
		expect(left.error).toBe(undefined);
		// Recorded open rather than left recorded ready, which is what makes the next
		// drain re-evaluate the ticket instead of re-shipping the same refused branch.
		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toEqual(expect.objectContaining({ phase: BranchPhase.Open }));
		expect(mockTakeGateHold).not.toHaveBeenCalled();
	});

	test('states its own reason for a ticket refusal that carried none, so an open ticket is never read as a park', async () => {
		const { cwd, outcome } = await setupReadyBranch();

		mockRunShip.mockResolvedValue({ status: ShipStatus.Blocked, branch: 'lo-70-drain', reason: ShipBlockReason.WorkOrderNotAuthorized, failingChecks: [] });

		const left = await ship({ cwd, outcome });

		// A blocked result need not carry a detail, and everything downstream tells
		// an open ticket from a parked one by whether `open` holds a sentence, so
		// this branch must never hand on an empty one.
		expect(left.open).toEqual(expect.stringMatching(/does not authorize/));
		expect(left.error).toBe(undefined);
		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toEqual(expect.objectContaining({ phase: BranchPhase.Open }));
	});
});
