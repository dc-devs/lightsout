import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { ShipResult } from '#src/contracts/ship/ShipResult.ts';
import { ShipStatus } from '#src/contracts/ship/ShipStatus.ts';
import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';
import type { ParkedWork } from '#src/queue/common/types/ParkedWork.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WorkOrderRunOutcome } from '#src/queue/common/types/WorkOrderRunOutcome.ts';
import type { nameWaveWorkOrders } from '#src/queue/nameWaveWorkOrders.ts';
import type { PullRequestSummary } from '#src/ship/forge/common/types/PullRequestSummary.ts';
import { nameWaveLikeTemplate } from '#tests/helpers/nameWaveLikeTemplate.ts';
import { queueTicketFixture as ticketOf } from '#tests/helpers/queueTicketFixture.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { setupQueueDrain } from '#tests/helpers/setupQueueDrain.ts';

/**
 * What the drain writes back to the tracker once a branch it shipped is
 * confirmed merged, and what it does when that write fails.
 *
 * A sibling of `runQueue.reconciliation.unit.test.ts` rather than more cases in
 * it: that file states which tickets a wave skips and which it works, while
 * every case here is about the Done write that follows a merge — an outcome the
 * drain must never un-ship over.
 */

// Mocked Imports
// -------------------------
// What this file owns is the drain's two ends: the ticket whose branch already
// merged before the wave started, and the ticket whose branch merged during it.
// The forge read and the Done write each have their own tests, so both are
// stubbed here — the questions are which tickets survive, what the report says,
// and what the coordinator run's status becomes.
type FindPullRequestParams = { branch: string; cwd: string; state: string };
type ReconcileShippedParams = { ticketRef: string | undefined; env: NodeJS.ProcessEnv };

const mockListEligibleTickets = jest.fn<() => Promise<TicketSummary[] | QueueFailure>>();
const mockScanParkedWorktrees = jest.fn<() => Promise<ParkedWork | QueueFailure>>();
const mockRunQueueTicket = jest.fn<(params: { workOrder: NamedWorkOrder }) => Promise<WorkOrderRunOutcome>>();
const mockFindPullRequest = jest.fn<(params: FindPullRequestParams) => Promise<PullRequestSummary | undefined>>();
const mockReconcileShippedTicket = jest.fn<(params: ReconcileShippedParams) => Promise<string | undefined>>();
const mockRunGates = jest.fn<(params: { cwd: string }) => Promise<GateRunResult>>();
const mockRunShip = jest.fn<(params: { cwd: string }) => Promise<ShipResult>>();

jest.mock('#src/queue/ticketSelection/listEligibleTickets.ts', () => ({ listEligibleTickets: () => mockListEligibleTickets() }));
jest.mock('#src/queue/worktrees/scanParkedWorktrees.ts', () => ({ scanParkedWorktrees: () => mockScanParkedWorktrees() }));
jest.mock('#src/queue/runQueueWorkOrder.ts', () => ({ runQueueWorkOrder: (params: { workOrder: NamedWorkOrder }) => mockRunQueueTicket(params) }));
jest.mock('#src/ticketTracker/index.ts', () => ({
	listLabelNames: () =>
		Promise.resolve(['planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan', 'planning-complete', 'planning-not-needed']),
	appendTicketNote: () => Promise.resolve(undefined),
	setTicketLabel: () => Promise.resolve(undefined),
}));
// -------------------------
// The lifecycle barrel keeps every other member real: the queue's startup check
// reads `TrackerStatusRole` through it.
jest.mock('#src/ticketLifecycle/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ticketLifecycle/index.ts')>('#src/ticketLifecycle/index.ts'),
	reconcileShippedTicket: (params: ReconcileShippedParams) => mockReconcileShippedTicket(params),
}));
// -------------------------
jest.mock('#src/gates/index.ts', () => ({
	...jest.requireActual<typeof import('#src/gates/index.ts')>('#src/gates/index.ts'),
	runGates: (params: { cwd: string }) => mockRunGates(params),
}));
// The two ends of the drain, stubbed on one barrel. Everything else stays real:
// `PullRequestState` is a plain constant nothing gains from doubling.
jest.mock('#src/ship/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ship/index.ts')>('#src/ship/index.ts'),
	findPullRequest: (params: FindPullRequestParams) => mockFindPullRequest(params),
	runShip: (params: { cwd: string }) => mockRunShip(params),
}));
// -------------------------
// Naming a wave creates work orders, which reads the tracker and spawns a
// harness — the work order module's own job, with its own tests. These cases
// keep the label and branch the queue's template renders, so what they state
// about branches and worktrees is what the drain itself decides.
const mockNameWaveWorkOrders = jest.fn<typeof nameWaveWorkOrders>(nameWaveLikeTemplate());

jest.mock('#src/queue/nameWaveWorkOrders.ts', () => ({
	nameWaveWorkOrders: (params: Parameters<typeof mockNameWaveWorkOrders>[0]) => mockNameWaveWorkOrders(params),
}));
// -------------------------

/** The environment the drain is handed, so a Done write reading credentials never has to reach `process.env`. */
const env = { LINEAR_API_KEY: 'lin_key' };

/** What the reconciler answers when the tracker would not take the Done write — a sentence, never an exception. */
const doneWriteRefusal = "LO-70 shipped, but its tracker status could not be moved to 'Done': the tracker refused";

const mergedPullRequest: PullRequestSummary = { number: 41, url: 'https://forge.example/pull/41', title: 'LO-70', branch: 'lo-70-ticket-70' };

const shippedResult: ShipResult = {
	status: ShipStatus.Shipped,
	branch: 'lo-70-ticket-70',
	ticketRef: 'lo-70',
	prNumber: 41,
	prUrl: 'https://forge.example/pull/41',
	prTitle: 'LO-70',
	mergeCommit: '0f1e2d3c',
	mergedAt: '2026-01-01T00:00:00.000Z',
	failingChecks: [],
};

/** The one manifest and the one plan the drain's coordinator run wrote. */
const readCoordinatorRun = ({ cwd }: { cwd: string }) => {
	const runsDir = dirname(runDirFor({ cwd, runId: 'any', pipeline: 'queue' }));
	const runId = readdirSync(runsDir)[0];
	const manifest = JSON.parse(readFileSync(join(runsDir, runId, 'manifest.json'), 'utf8')) as RunManifest;

	return { manifest, plan: readFileSync(join(runsDir, runId, 'queue.md'), 'utf8') };
};

/** A backlog the forge answers for: a merged pull request on the branch of every ticket the test names. */
const setupMergedWave = ({ merged = [], doneWriteFailure }: { merged?: number[]; doneWriteFailure?: string } = {}) => {
	const { cwd } = setupBranchRepo();

	// Every machine-local record a branch keeps is filed with the work order whose
	// record stores it, so both branches of this wave have one.
	seedWorkOrderRecord({ cwd, name: 'lo-70-ticket-70', ticketRef: 'LO-70' });
	seedWorkOrderRecord({ cwd, name: 'lo-71-ticket-71', ticketRef: 'LO-71' });

	mockListEligibleTickets.mockResolvedValue([ticketOf({ number: 70 }), ticketOf({ number: 71 })]);
	mockScanParkedWorktrees.mockResolvedValue({ resumed: [], outcomes: [], leftBehind: [], merged: [] });
	// The surviving ticket parks rather than finishing: this factory is about
	// which tickets reach a worker at all, and a ready one would send the serial
	// merge at a worktree no test here ever built.
	mockRunQueueTicket.mockImplementation(({ workOrder: { ticket } }) =>
		Promise.resolve({
			ticket,
			name: `${ticket.identifier.toLowerCase()}-ticket-${ticket.id}`,
			branch: `${ticket.identifier.toLowerCase()}-ticket-${ticket.id}`,
			worktreePath: `/tmp/${ticket.identifier}`,
			ready: false,
			error: 'tsc: 3 errors',
		}),
	);
	mockFindPullRequest.mockImplementation(({ branch }) =>
		Promise.resolve(merged.some((number) => branch.startsWith(`lo-${number}-`)) ? mergedPullRequest : undefined),
	);
	mockReconcileShippedTicket.mockResolvedValue(doneWriteFailure);

	return setupQueueDrain({ cwd, env });
};

/** A parked branch with real commits on it, ready for the serial merge and nothing else. */
const setupShippedBranch = ({ doneWriteFailure }: { doneWriteFailure?: string } = {}) => {
	const { cwd } = setupBranchRepo();
	const branch = 'lo-70-ticket-70';
	const worktreePath = join(dirname(cwd), `${basename(cwd)}-worktrees`, branch);

	execFileSync('git', ['worktree', 'add', worktreePath, '-b', branch, 'origin/main'], { cwd, stdio: 'ignore' });
	writeFileSync(join(worktreePath, 'work.ts'), 'export const work = 1;\n');
	execFileSync('git', ['add', '-A'], { cwd: worktreePath, stdio: 'ignore' });
	execFileSync('git', ['commit', '-qm', 'work'], { cwd: worktreePath, stdio: 'ignore' });

	const ready: WorkOrderRunOutcome = { ticket: ticketOf({ number: 70 }), name: branch, branch, worktreePath, ready: true };

	mockListEligibleTickets.mockResolvedValue([]);
	mockScanParkedWorktrees.mockResolvedValue({ resumed: [], outcomes: [ready], leftBehind: [], merged: [] });
	mockFindPullRequest.mockResolvedValue(undefined);
	mockRunGates.mockResolvedValue({ error: undefined, failedFamilies: [], crashes: [], timeouts: [], coordination: undefined });
	mockRunShip.mockResolvedValue(shippedResult);
	mockReconcileShippedTicket.mockResolvedValue(doneWriteFailure);

	return { ready, ...setupQueueDrain({ cwd, env }) };
};

describe('runQueue', () => {
	test('hands the drain’s own environment to the Done write, so the tracker credentials never come from the process', async () => {
		const { drain, relay } = setupMergedWave({ merged: [70] });

		await drain();
		relay.close();

		expect(mockReconcileShippedTicket).toHaveBeenCalledWith(expect.objectContaining({ ticketRef: 'LO-70', env: { LINEAR_API_KEY: 'lin_key' } }));
	});

	test('still skips the already-merged ticket when the Done write failed, folding the reason in rather than building it again', async () => {
		const { drain, relay, progress } = setupMergedWave({ merged: [70], doneWriteFailure: doneWriteRefusal });

		const report = await drain();

		relay.close();

		expect(report).toEqual({
			outcomes: [expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-71' }) })],
			leftBehind: [expect.objectContaining({ identifier: 'LO-70', reason: expect.stringContaining("could not be moved to 'Done'"), settled: true })],
		});
		expect(progress).toContainEqual(expect.stringContaining("could not be moved to 'Done'"));
	});

	test('moves a branch it merged in the drain to done, naming the reference the ship result carried', async () => {
		const { drain, relay } = setupShippedBranch();

		await drain();
		relay.close();

		expect(mockReconcileShippedTicket).toHaveBeenCalledWith(expect.objectContaining({ ticketRef: 'lo-70', env: { LINEAR_API_KEY: 'lin_key' } }));
	});

	test('leaves a shipped outcome exactly as it was when the Done write succeeded', async () => {
		const { ready, drain, relay } = setupShippedBranch();

		const report = await drain();

		relay.close();

		expect(report).toStrictEqual({ outcomes: [ready], leftBehind: [] });
	});

	test('carries a failed Done write beside the shipped outcome without un-shipping the branch', async () => {
		const { drain, relay } = setupShippedBranch({ doneWriteFailure: doneWriteRefusal });

		const report = await drain();

		relay.close();

		expect(report).toEqual({
			outcomes: [expect.objectContaining({ ready: true, reconciliationFailure: doneWriteRefusal })],
			leftBehind: [],
		});
	});

	test('ends the coordinator run passed though the Done write failed, because a tracker cannot undo a confirmed merge', async () => {
		const { cwd, drain, relay } = setupShippedBranch({ doneWriteFailure: 'the tracker refused' });

		await drain();
		relay.close();

		expect(readCoordinatorRun({ cwd }).manifest.status).toBe(RunStatus.Passed);
	});
});
