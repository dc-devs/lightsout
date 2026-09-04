import { execSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { type LightsoutConfig, type ShipResult, ShipStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { runQueue } from '#src/queue/index.ts';
import type { PullRequestSummary } from '#src/ship/index.ts';
import type { TrackerFailure, TrackerSettings, TrackerTicket } from '#src/ticketTracker/index.ts';
import { committedPaths } from '#tests/helpers/committedPaths.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { terminalRelayFixture } from '#tests/helpers/terminalRelayFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

// Mocked Imports
// -------------------------
// Only what would leave the machine or spend real minutes is stubbed: the
// tracker, the forge, the gates and the harness. Git, the worktrees and the
// commit step are all real, because what this file owns is whether the
// config's `generated` list actually reaches git — a claim only a real commit
// on a real branch can settle.
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

/** `plugin/dist/` is the shape this repo configures: a directory of build output rebuilt by every gate run. */
const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false }, generated: ['plugin/dist/'] };
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

const ticket: TrackerTicket = {
	id: 'id-70',
	identifier: 'LO-70',
	title: 'Drain the backlog',
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: ['planning-not-needed'],
	status: 'Ready to implement',
	unfinishedBlockers: [],
};

/** Where the queue puts this ticket's worktree, spelled out rather than imported so the path is pinned by a second statement of the same rule. */
const worktreeOf = ({ cwd }: { cwd: string }) => join(dirname(cwd), `${basename(cwd)}-worktrees`, branch);

/** A worker session that leaves its work uncommitted, so the queue's own commit step is what decides what the branch carries. */
const leaveWork = ({ worktreePath, source }: { worktreePath: string; source: boolean }): Promise<WorkerOutcome> => {
	if (source) {
		writeRepoFile({ cwd: worktreePath, path: 'work.ts', content: 'export const value = 1;\n' });
	}

	writeRepoFile({ cwd: worktreePath, path: 'plugin/dist/cli.mjs', content: '// rebuilt by the gates\n' });

	return Promise.resolve({});
};

/**
 * A real repo with a real remote, one eligible ticket, and every worker step
 * stubbed green.
 *
 * `gateError` is how a test keeps the worktree on disk to read: the re-gate
 * after the rebase parks the branch, and a parked branch is never cleaned up.
 */
const setupQueueRun = ({ gateError }: { gateError?: string } = {}) => {
	const { cwd } = setupBranchRepo();
	const progress: string[] = [];
	const relay = terminalRelayFixture();

	// Run state is ignored the way a consumer repo ignores it — without that, the
	// commit step's `git add -A` would sweep the run's own records onto the branch.
	writeRepoFile({ cwd, path: '.gitignore', content: '.lightsout/\n' });
	execSync('git add -A && git commit -qm ignore && git push -q origin main', { cwd, stdio: 'ignore' });

	mockListTickets.mockResolvedValue([ticket]);
	mockGetTicketsByIdentifiers.mockResolvedValue([]);
	mockSetTicketStatus.mockResolvedValue(undefined);
	mockSetParkedLabel.mockResolvedValue(undefined);
	mockReconcileShippedTicket.mockResolvedValue(undefined);
	mockFindPullRequest.mockResolvedValue(undefined);
	mockRunGates.mockResolvedValue({ error: gateError, failedFamilies: gateError === undefined ? [] : ['check'], crashes: [] });
	mockRunShip.mockResolvedValue(shippedResult);
	mockRunWorkerWithRelay.mockResolvedValue({});

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

	return { cwd, progress, drain, relay };
};

describe('runQueue', () => {
	test('keeps the build output a worker rebuilt off the ticket branch, so a later branch has no generated file to conflict with', async () => {
		const { cwd, drain, relay } = setupQueueRun({ gateError: 'tsc: 3 errors' });

		mockRunWorkerWithRelay.mockImplementation(({ worktreePath }) => leaveWork({ worktreePath, source: true }));

		await drain();

		relay.close();

		// The whole chain in one claim: the config's `generated` list reached the
		// commit step through the queue, and the branch carries source alone.
		expect(committedPaths({ cwd: worktreeOf({ cwd }) })).toStrictEqual(['work.ts']);
	});

	test('parks a ticket whose worker rebuilt build output and nothing else, and leaves its worktree clean for the ship step', async () => {
		const { cwd, drain, relay } = setupQueueRun();

		mockRunWorkerWithRelay.mockImplementation(({ worktreePath }) => leaveWork({ worktreePath, source: false }));

		const report = await drain();

		relay.close();

		expect(report).toEqual({
			outcomes: [expect.objectContaining({ branch, ready: false, error: 'the worker left no commits on the branch' })],
			leftBehind: [],
		});
		// Discarded, not merely left unstaged: a dirty tree is what the ship step's
		// own precondition refuses, so leaving it would trade one block for another.
		expect(execSync('git status --porcelain', { cwd: worktreeOf({ cwd }) }).toString()).toBe('');
	});
});
