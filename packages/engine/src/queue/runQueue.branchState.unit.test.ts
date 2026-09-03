import { execFileSync, execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { BranchPhase, type LightsoutConfig, type ShipResult, ShipStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { readBranchState, runQueue, writeBranchState } from '#src/queue/index.ts';
import type { PullRequestSummary } from '#src/ship/index.ts';
import type { TrackerFailure, TrackerSettings, TrackerTicket } from '#src/ticketTracker/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { terminalRelayFixture } from '#tests/helpers/terminalRelayFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// Only what would leave the machine or spend real minutes is stubbed: the
// tracker, the forge, the gates and the harness. Git, the worktrees and the
// branch-state record on disk are all real, because what this file owns is
// whether the record one step writes is the record the next step reads — the
// pickup, the readiness verdict, the merge and the resume scan, in one drain
// and across two.
type ListTicketsParams = { settings: TrackerSettings; labelNames: string[]; statuses: string[] };
type IdentifiersParams = { settings: TrackerSettings; identifiers: string[] };
type StatusParams = { settings: TrackerSettings; ticketId: string; statusName: string };
type LabelParams = { settings: TrackerSettings; ticketId: string; label: string | undefined; parked: boolean };

const mockListTickets = jest.fn<(params: ListTicketsParams) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockGetTicketsByIdentifiers = jest.fn<(params: IdentifiersParams) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockSetTicketStatus = jest.fn<(params: StatusParams) => Promise<TrackerFailure | undefined>>();
const mockSetParkedLabel = jest.fn<(params: LabelParams) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	listLabelNames: () =>
		Promise.resolve(['planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan', 'planning-complete', 'planning-not-needed']),
	appendTicketNote: () => Promise.resolve(undefined),
	getTicketsByIdentifiers: (params: IdentifiersParams) => mockGetTicketsByIdentifiers(params),
	listTickets: (params: ListTicketsParams) => mockListTickets(params),
	setParkedLabel: (params: LabelParams) => mockSetParkedLabel(params),
	setTicketStatus: (params: StatusParams) => mockSetTicketStatus(params),
}));
// -------------------------
type ReconcileShippedParams = { ticketRef: string | undefined; env: NodeJS.ProcessEnv };

const mockReconcileShippedTicket = jest.fn<(params: ReconcileShippedParams) => Promise<string | undefined>>();

// The lifecycle barrel keeps every other member real: the startup check reads
// `TrackerStatusRole` through it and the pickup writes the ticket's status
// through it, so only the Done write is doubled.
jest.mock('#src/ticketLifecycle/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ticketLifecycle/index.ts')>('#src/ticketLifecycle/index.ts'),
	reconcileShippedTicket: (params: ReconcileShippedParams) => mockReconcileShippedTicket(params),
}));
// -------------------------
const mockRunGates = jest.fn<(params: { cwd: string }) => Promise<GateRunResult>>();

jest.mock('#src/gates/index.ts', () => ({ runGates: (params: { cwd: string }) => mockRunGates(params) }));
// -------------------------
type FindPullRequestParams = { branch: string; cwd: string; state: string };

const mockFindPullRequest = jest.fn<(params: FindPullRequestParams) => Promise<PullRequestSummary | undefined>>();
const mockRunShip = jest.fn<(params: { cwd: string }) => Promise<ShipResult>>();

jest.mock('#src/ship/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ship/index.ts')>('#src/ship/index.ts'),
	findPullRequest: (params: FindPullRequestParams) => mockFindPullRequest(params),
	runShip: (params: { cwd: string }) => mockRunShip(params),
}));
// -------------------------
const mockRunWorkerWithRelay = jest.fn<(params: { worktreePath: string }) => Promise<WorkerOutcome>>();

jest.mock('#src/queue/runWorkerWithRelay.ts', () => ({ runWorkerWithRelay: (params: { worktreePath: string }) => mockRunWorkerWithRelay(params) }));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };

/** The environment the drain is handed, so a tracker write reading credentials never has to reach `process.env`. */
const env = { LINEAR_API_KEY: 'lin_key' };

/** The branch `queue.branch-template` renders for the one ticket every test here uses. */
const branch = 'lo-70-drain-the-backlog';

const shippedResult: ShipResult = {
	status: ShipStatus.Shipped,
	branch,
	ticketRef: 'lo-70',
	prNumber: 41,
	prUrl: 'https://forge.example/pull/41',
	prTitle: 'LO-70',
	mergeCommit: '0f1e2d3c',
	mergedAt: '2026-01-01T00:00:00.000Z',
	failingChecks: [],
};

const ticketOf = ({ status }: { status: string }): TrackerTicket => ({
	id: 'id-70',
	identifier: 'LO-70',
	title: 'Drain the backlog',
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: ['planning-not-needed'],
	status,
	unfinishedBlockers: [],
});

/** Where the queue puts this ticket's worktree, spelled out rather than imported so the path is pinned by a second statement of the same rule. */
const worktreeOf = ({ cwd }: { cwd: string }) => join(dirname(cwd), `${basename(cwd)}-worktrees`, branch);

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

/** A worker session that writes its work and commits it itself — what a run killed after its own commit leaves behind. */
const commitInWorktree = ({ worktreePath }: { worktreePath: string }): Promise<WorkerOutcome> => {
	writeFileSync(join(worktreePath, 'work.ts'), 'export const value = 1;\n');
	execSync('git add -A && git commit -qm work', { cwd: worktreePath, stdio: 'ignore' });

	return Promise.resolve({});
};

/** A real repo with a real remote, the tracker answering whatever the test names, and every worker step stubbed green. */
const setupQueueRun = ({ eligible = [], parked = [], gateError }: { eligible?: TrackerTicket[]; parked?: TrackerTicket[]; gateError?: string } = {}) => {
	const { cwd } = setupBranchRepo();
	const progress: string[] = [];

	mockListTickets.mockResolvedValue(eligible);
	mockGetTicketsByIdentifiers.mockResolvedValue(parked);
	mockSetTicketStatus.mockResolvedValue(undefined);
	mockSetParkedLabel.mockResolvedValue(undefined);
	mockReconcileShippedTicket.mockResolvedValue(undefined);
	mockFindPullRequest.mockResolvedValue(undefined);
	mockRunGates.mockResolvedValue({ error: gateError, failedFamilies: gateError === undefined ? [] : ['check'] });
	mockRunShip.mockResolvedValue(shippedResult);
	mockRunWorkerWithRelay.mockResolvedValue({});

	return { cwd, progress, ...startDrain({ cwd, progress }) };
};

/**
 * A repo an earlier drain left mid-flight: its worker finished, the branch was
 * recorded ready, and only the merge failed — so the worktree is still on disk
 * and the ticket sits at the in-progress status the eligible query cannot see.
 *
 * The first drain is arrangement, so the worker's call log is cleared before the
 * test acts: what the act must show is that the SECOND drain spends no worker.
 */
const setupUnshippedBranch = async () => {
	const first = setupQueueRun({ eligible: [ticketOf({ status: 'Ready to implement' })], gateError: 'tsc: 3 errors' });

	mockRunWorkerWithRelay.mockImplementation(commitInWorktree);

	await first.drain();
	first.relay.close();

	mockListTickets.mockResolvedValue([]);
	mockGetTicketsByIdentifiers.mockResolvedValue([ticketOf({ status: 'In Progress' })]);
	mockRunGates.mockResolvedValue({ error: undefined, failedFamilies: [] });
	mockRunWorkerWithRelay.mockClear();

	const progress: string[] = [];

	return { cwd: first.cwd, progress, ...startDrain({ cwd: first.cwd, progress }) };
};

/**
 * The leftovers of a run killed between the merge and the cleanup that follows
 * it: the branch is recorded merged, its worktree survived, and its ticket is
 * still at the in-progress status no eligible query returns.
 */
const setupMergedWorktree = async () => {
	const base = setupQueueRun({ parked: [ticketOf({ status: 'In Progress' })] });

	execFileSync('git', ['worktree', 'add', worktreeOf({ cwd: base.cwd }), '-b', branch, 'origin/main'], { cwd: base.cwd, stdio: 'ignore' });
	await writeBranchState({ cwd: base.cwd, branch, phase: BranchPhase.Merged });

	return base;
};

describe('runQueue', () => {
	test('ships a ticket whose worker committed its own work, rather than reporting that the session changed nothing', async () => {
		const { drain, relay } = setupQueueRun({ eligible: [ticketOf({ status: 'Ready to implement' })] });

		mockRunWorkerWithRelay.mockImplementation(commitInWorktree);

		const report = await drain();

		relay.close();

		// The queue's own commit step found nothing left to add. The branch still
		// carries the work, and that is what settles it ready.
		expect(report).toEqual({ outcomes: [expect.objectContaining({ branch, ready: true })], leftBehind: [] });
	});

	test('parks a ticket whose worker left no commits at all, and records the branch as still being built', async () => {
		const { cwd, drain, relay } = setupQueueRun({ eligible: [ticketOf({ status: 'Ready to implement' })] });

		const report = await drain();

		relay.close();

		expect(report).toEqual({ outcomes: [expect.objectContaining({ ready: false, error: 'the worker left no commits on the branch' })], leftBehind: [] });
		// Still building, so the next run resumes the ticket instead of merging it.
		expect(await readBranchState({ cwd, branch })).toEqual(expect.objectContaining({ phase: BranchPhase.Building }));
	});

	test('merges a branch an earlier drain finished but could not ship, without spending a second worker on it', async () => {
		const { drain, relay } = await setupUnshippedBranch();

		const report = await drain();

		relay.close();

		expect(report).toEqual({ outcomes: [expect.objectContaining({ branch, ready: true })], leftBehind: [] });
		expect(mockRunWorkerWithRelay).not.toHaveBeenCalled();
	});

	test('records that resumed branch merged and removes the worktree the earlier drain left behind', async () => {
		const { cwd, drain, relay } = await setupUnshippedBranch();

		await drain();
		relay.close();

		expect(await readBranchState({ cwd, branch })).toEqual(expect.objectContaining({ phase: BranchPhase.Merged }));
		expect(existsSync(worktreeOf({ cwd }))).toBe(false);
	});

	test('finishes a parked worktree its own record already calls merged, rather than handing the ticket back to a worker', async () => {
		const { drain, relay } = await setupMergedWorktree();

		const report = await drain();

		relay.close();

		// The scan is real here, so this is the whole path: git listed the tree, the
		// record settled it, and the drain finished it inside the run lock.
		expect(report).toEqual({
			outcomes: [],
			leftBehind: [expect.objectContaining({ identifier: 'LO-70', reason: expect.stringContaining('already recorded merged'), settled: true })],
		});
		expect(mockRunWorkerWithRelay).not.toHaveBeenCalled();
	});

	test('reconciles that ticket to done and drops its worktree, because nothing else can reach it once the merge has happened', async () => {
		const { cwd, drain, relay } = await setupMergedWorktree();

		await drain();
		relay.close();

		expect(mockReconcileShippedTicket).toHaveBeenCalledWith(expect.objectContaining({ ticketRef: 'LO-70' }));
		expect(existsSync(worktreeOf({ cwd }))).toBe(false);
	});
});
