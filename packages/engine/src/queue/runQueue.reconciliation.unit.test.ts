import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { BranchPhase, type LightsoutConfig, type RunManifest, RunStatus, type ShipResult, ShipStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { ParkedWork } from '#src/queue/common/types/ParkedWork.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { readBranchState, runQueue, writeBranchState } from '#src/queue/index.ts';
import type { PullRequestSummary } from '#src/ship/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { terminalRelayFixture } from '#tests/helpers/terminalRelayFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

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
const mockRunQueueTicket = jest.fn<(params: { ticket: TicketSummary }) => Promise<TicketRunOutcome>>();
const mockFindPullRequest = jest.fn<(params: FindPullRequestParams) => Promise<PullRequestSummary | undefined>>();
const mockReconcileShippedTicket = jest.fn<(params: ReconcileShippedParams) => Promise<string | undefined>>();
const mockRunGates = jest.fn<(params: { cwd: string }) => Promise<GateRunResult>>();
const mockRunShip = jest.fn<(params: { cwd: string }) => Promise<ShipResult>>();

jest.mock('#src/queue/listEligibleTickets.ts', () => ({ listEligibleTickets: () => mockListEligibleTickets() }));
jest.mock('#src/queue/scanParkedWorktrees.ts', () => ({ scanParkedWorktrees: () => mockScanParkedWorktrees() }));
jest.mock('#src/queue/runQueueTicket.ts', () => ({ runQueueTicket: (params: { ticket: TicketSummary }) => mockRunQueueTicket(params) }));
jest.mock('#src/ticketTracker/index.ts', () => ({
	listLabelNames: () =>
		Promise.resolve(['planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan', 'planning-complete', 'planning-not-needed']),
	appendTicketNote: () => Promise.resolve(undefined),
	setParkedLabel: () => Promise.resolve(undefined),
}));
// -------------------------
// The lifecycle barrel keeps every other member real: the queue's startup check
// reads `TrackerStatusRole` through it.
jest.mock('#src/ticketLifecycle/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ticketLifecycle/index.ts')>('#src/ticketLifecycle/index.ts'),
	reconcileShippedTicket: (params: ReconcileShippedParams) => mockReconcileShippedTicket(params),
}));
// -------------------------
jest.mock('#src/gates/index.ts', () => ({ runGates: (params: { cwd: string }) => mockRunGates(params) }));
// The two ends of the drain, stubbed on one barrel. Everything else stays real:
// `PullRequestState` is a plain constant nothing gains from doubling.
jest.mock('#src/ship/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ship/index.ts')>('#src/ship/index.ts'),
	findPullRequest: (params: FindPullRequestParams) => mockFindPullRequest(params),
	runShip: (params: { cwd: string }) => mockRunShip(params),
}));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };

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

/** One drain of the repo at `cwd`, with the collaborators each factory already wired. */
const startDrain = ({ cwd, progress }: { cwd: string; progress: string[] }) => {
	const relay = terminalRelayFixture();

	const drain = () =>
		runQueue({
			cwd,
			settings: queueSettingsFixture(),
			trackerSettings: trackerSettingsFixture(),
			shipSettings: shipSettingsFixture(),
			config,
			env,
			driver,
			driverName: 'claude-code',
			relay,
			onProgress: (message) => progress.push(message),
		});

	return { drain, relay };
};

/** The one manifest and the one plan the drain's coordinator run wrote. */
const readCoordinatorRun = ({ cwd }: { cwd: string }) => {
	const runsDir = join(cwd, '.lightsout', 'runs');
	const runId = readdirSync(runsDir)[0];
	const manifest = JSON.parse(readFileSync(join(runsDir, runId, 'manifest.json'), 'utf8')) as RunManifest;

	return { manifest, plan: readFileSync(join(runsDir, runId, 'queue.md'), 'utf8') };
};

/** A backlog the forge answers for: a merged pull request on the branch of every ticket the test names. */
const setupMergedWave = ({ merged = [], doneWriteFailure }: { merged?: number[]; doneWriteFailure?: string } = {}) => {
	const { cwd } = setupBranchRepo();
	const progress: string[] = [];

	mockListEligibleTickets.mockResolvedValue([ticketOf({ number: 70 }), ticketOf({ number: 71 })]);
	mockScanParkedWorktrees.mockResolvedValue({ resumed: [], outcomes: [], leftBehind: [], merged: [] });
	// The surviving ticket parks rather than finishing: this factory is about
	// which tickets reach a worker at all, and a ready one would send the serial
	// merge at a worktree no test here ever built.
	mockRunQueueTicket.mockImplementation(({ ticket }) =>
		Promise.resolve({
			ticket,
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

	return { cwd, progress, ...startDrain({ cwd, progress }) };
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

	const ready: TicketRunOutcome = { ticket: ticketOf({ number: 70 }), branch, worktreePath, ready: true };
	const progress: string[] = [];

	mockListEligibleTickets.mockResolvedValue([]);
	mockScanParkedWorktrees.mockResolvedValue({ resumed: [], outcomes: [ready], leftBehind: [], merged: [] });
	mockFindPullRequest.mockResolvedValue(undefined);
	mockRunGates.mockResolvedValue({ error: undefined, failedFamilies: [] });
	mockRunShip.mockResolvedValue(shippedResult);
	mockReconcileShippedTicket.mockResolvedValue(doneWriteFailure);

	return { cwd, ready, progress, ...startDrain({ cwd, progress }) };
};

/**
 * A parked worktree whose branch this machine already recorded merged, and
 * nothing else: the leftovers of a run killed between the merge and the cleanup
 * that follows it. The eligible query cannot see the ticket, so this scan result
 * is the only thing that can reach it.
 */
const setupMergedTree = () => {
	const { cwd } = setupBranchRepo();
	const branch = 'lo-70-ticket-70';
	const worktreePath = join(dirname(cwd), `${basename(cwd)}-worktrees`, branch);

	execFileSync('git', ['worktree', 'add', worktreePath, '-b', branch, 'origin/main'], { cwd, stdio: 'ignore' });

	const progress: string[] = [];

	mockListEligibleTickets.mockResolvedValue([]);
	mockScanParkedWorktrees.mockResolvedValue({
		resumed: [],
		outcomes: [],
		leftBehind: [],
		merged: [{ worktreePath, branch, ticket: ticketOf({ number: 70 }) }],
	});
	mockFindPullRequest.mockResolvedValue(undefined);
	mockReconcileShippedTicket.mockResolvedValue(undefined);

	return { cwd, worktreePath, progress, ...startDrain({ cwd, progress }) };
};

describe('runQueue', () => {
	test('finishes a parked worktree already recorded merged, rather than stopping before the lock that settles it', async () => {
		const { worktreePath, drain, relay } = setupMergedTree();

		const report = await drain();

		relay.close();

		expect(report).toEqual({
			outcomes: [],
			leftBehind: [{ identifier: 'LO-70', reason: expect.stringContaining('held a branch already recorded merged'), settled: true }],
		});
		expect(mockReconcileShippedTicket).toHaveBeenCalledWith(expect.objectContaining({ ticketRef: 'LO-70' }));
		// The tree is clean, so it goes; a worker is never spent on work that merged.
		expect(existsSync(worktreePath)).toBe(false);
		expect(mockRunQueueTicket).not.toHaveBeenCalled();
	});

	test('ends the coordinator run passed when a merged worktree was all the scan found, because nothing waits on a re-run', async () => {
		const { cwd, drain, relay } = setupMergedTree();

		await drain();
		relay.close();

		expect(readCoordinatorRun({ cwd }).manifest.status).toBe(RunStatus.Passed);
	});

	test('spends no worker on a ticket whose branch already carries a merged pull request', async () => {
		const { drain, relay } = setupMergedWave({ merged: [70] });

		await drain();
		relay.close();

		expect(mockRunQueueTicket.mock.calls.map((call) => call[0].ticket.identifier)).toStrictEqual(['LO-71']);
	});

	test('asks the forge to confirm the merge on the ticket’s own branch, rather than inferring one', async () => {
		const { cwd, drain, relay } = setupMergedWave({ merged: [70] });

		await drain();
		relay.close();

		expect(mockFindPullRequest).toHaveBeenCalledWith({ branch: 'lo-70-ticket-70', cwd, state: 'merged' });
	});

	test('reports the already-merged ticket as settled, naming the pull request that proves it shipped', async () => {
		const { drain, relay } = setupMergedWave({ merged: [70] });

		const report = await drain();

		relay.close();

		expect(report).toEqual({
			outcomes: [expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-71' }) })],
			leftBehind: [{ identifier: 'LO-70', reason: expect.stringContaining('already has a merged pull request #41'), settled: true }],
		});
	});

	test('ends the coordinator run passed when the only entry left behind was a reconciled ticket, because nothing waits on a re-run', async () => {
		const { cwd, drain, relay } = setupMergedWave({ merged: [70, 71] });

		const report = await drain();

		relay.close();

		expect(report).toEqual({ outcomes: [], leftBehind: [expect.objectContaining({ settled: true }), expect.objectContaining({ settled: true })] });
		expect(readCoordinatorRun({ cwd }).manifest.status).toBe(RunStatus.Passed);
	});

	test('skips a ticket whose branch this machine already recorded merged, without asking the forge about it', async () => {
		const { cwd, drain, relay } = setupMergedWave();

		await writeBranchState({ cwd, branch: 'lo-70-ticket-70', phase: BranchPhase.Merged });

		const report = await drain();

		relay.close();

		// Offline after a restart: the forge is asked only about the branch nothing
		// on this machine has an answer for.
		expect(mockFindPullRequest.mock.calls.map((call) => call[0].branch)).toStrictEqual(['lo-71-ticket-71']);
		expect(mockRunQueueTicket.mock.calls.map((call) => call[0].ticket.identifier)).toStrictEqual(['LO-71']);
		expect(report).toEqual(
			expect.objectContaining({ leftBehind: [{ identifier: 'LO-70', reason: expect.stringContaining('is recorded merged'), settled: true }] }),
		);
	});

	test('records a merge the forge established, so a second run skips the ticket without asking again', async () => {
		const { cwd, drain, relay } = setupMergedWave({ merged: [70] });

		await drain();
		relay.close();

		expect(await readBranchState({ cwd, branch: 'lo-70-ticket-70' })).toEqual(expect.objectContaining({ phase: BranchPhase.Merged }));
	});

	test('records only the tickets it will actually work in the coordinator run, not the one it reconciled', async () => {
		const { cwd, drain, relay } = setupMergedWave({ merged: [70] });

		await drain();
		relay.close();

		const { plan } = readCoordinatorRun({ cwd });

		expect(plan).toContain('LO-71 · direct · lo-71-ticket-71 ·');
		expect(plan).not.toContain('LO-70');
	});

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
