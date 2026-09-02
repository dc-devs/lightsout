import { execSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { runQueue } from '#src/queue/index.ts';
import type { ShipSettings } from '#src/ship/index.ts';
import type { TrackerFailure, TrackerSettings, TrackerTicket } from '#src/ticketTracker/index.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { terminalRelayFixture } from '#tests/helpers/terminalRelayFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The tracker is the only boundary stubbed whole here, so every queue step
// between `runQueue` and a tracker call runs for real: the eligible read, the
// resume scan, the per-ticket pickup, the wave re-read and the label settle.
// That is what makes the identity each call receives observable.
type ListTicketsParams = { settings: TrackerSettings; labelNames: string[]; statuses: string[] };
type IdentifiersParams = { settings: TrackerSettings; identifiers: string[] };
type StatusParams = { settings: TrackerSettings; ticketId: string; statusName: string };
type LabelParams = { settings: TrackerSettings; ticketId: string; label: string | undefined; parked: boolean };

const mockListTickets = jest.fn<(params: ListTicketsParams) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockGetTicketsByIdentifiers = jest.fn<(params: IdentifiersParams) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockSetTicketStatus = jest.fn<(params: StatusParams) => Promise<TrackerFailure | undefined>>();
const mockSetParkedLabel = jest.fn<(params: LabelParams) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	appendTicketNote: () => Promise.resolve(undefined),
	getTicketsByIdentifiers: (params: IdentifiersParams) => mockGetTicketsByIdentifiers(params),
	listTickets: (params: ListTicketsParams) => mockListTickets(params),
	setParkedLabel: (params: LabelParams) => mockSetParkedLabel(params),
	setTicketStatus: (params: StatusParams) => mockSetTicketStatus(params),
}));
// -------------------------
// The three steps that would spend real time on a machine: cutting a worktree,
// running a harness, and merging. Each is covered by its own tests, and none of
// them reads tracker identity.
const mockCreateTicketWorktree = jest.fn<(params: { cwd: string; branch: string }) => Promise<string | QueueFailure>>();

jest.mock('#src/queue/createTicketWorktree.ts', () => ({
	createTicketWorktree: (params: { cwd: string; branch: string }) => mockCreateTicketWorktree(params),
}));
// -------------------------
const mockRunWorkerWithRelay = jest.fn<() => Promise<WorkerOutcome>>();

jest.mock('#src/queue/runWorkerWithRelay.ts', () => ({ runWorkerWithRelay: () => mockRunWorkerWithRelay() }));
// -------------------------
jest.mock('#src/queue/commitTicketWork.ts', () => ({ commitTicketWork: () => Promise.resolve({ committed: true }) }));
// -------------------------
const mockShipReadyBranches = jest.fn<(params: { ready: TicketRunOutcome[] }) => Promise<TicketRunOutcome[]>>();

jest.mock('#src/queue/shipReadyBranches.ts', () => ({ shipReadyBranches: (params: { ready: TicketRunOutcome[] }) => mockShipReadyBranches(params) }));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };

const ticketOf = ({
	number,
	labels = ['route-direct'],
	unfinishedBlockers = [],
}: {
	number: number;
	labels?: string[];
	unfinishedBlockers?: string[];
}): TrackerTicket => ({
	id: `id-${number}`,
	identifier: `LO-${number}`,
	title: `Ticket ${number}`,
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels,
	unfinishedBlockers,
});

/**
 * A repo with a remote behind it, the tracker stubbed green, and optionally one
 * worktree left on disk by an earlier drain.
 *
 * The worktrees root is spelled out rather than imported, so the path the queue
 * builds is pinned by a second statement of the same rule.
 */
const setupDrain = ({
	eligible = [],
	parkedTicket,
	parkedBranch,
}: {
	eligible?: TrackerTicket[];
	parkedTicket?: TrackerTicket;
	parkedBranch?: string;
} = {}) => {
	const { cwd } = setupBranchRepo();
	const worktreesRoot = join(dirname(cwd), `${basename(cwd)}-worktrees`);

	execSync('git config user.name t && git config user.email t@t', { cwd, stdio: 'ignore' });

	if (parkedBranch !== undefined) {
		execSync(`git worktree add -q ${join(worktreesRoot, parkedBranch)} -b ${parkedBranch} origin/main`, { cwd, stdio: 'ignore' });
	}

	mockListTickets.mockResolvedValue(eligible);
	mockGetTicketsByIdentifiers.mockResolvedValue(parkedTicket === undefined ? [] : [parkedTicket]);
	mockSetTicketStatus.mockResolvedValue(undefined);
	mockSetParkedLabel.mockResolvedValue(undefined);
	mockCreateTicketWorktree.mockImplementation(({ branch }) => Promise.resolve(join(worktreesRoot, branch)));
	mockRunWorkerWithRelay.mockResolvedValue({});
	mockShipReadyBranches.mockImplementation(({ ready }) => Promise.resolve(ready));

	const relay = terminalRelayFixture();
	const drain = ({
		settings = queueSettingsFixture(),
		trackerSettings = trackerSettingsFixture(),
		ship = shipSettingsFixture(),
	}: {
		settings?: QueueSettings;
		trackerSettings?: TrackerSettings;
		ship?: ShipSettings;
	} = {}) => runQueue({ cwd, settings, trackerSettings, shipSettings: ship, config, driver, driverName: 'claude-code', relay });

	return { drain, relay };
};

describe('runQueue', () => {
	test('reads the backlog with the resolved tracker identity, and with the route labels and statuses the queue block still owns', async () => {
		const { drain, relay } = setupDrain();

		await drain();
		relay.close();

		expect(mockListTickets).toHaveBeenCalledWith({
			settings: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey: 'lin_key' },
			labelNames: ['route-direct', 'route-auto-plan'],
			statuses: ['Backlog'],
		});
	});

	test('moves a picked-up ticket with the tracker identity, to the in-progress status the queue block names', async () => {
		const { drain, relay } = setupDrain({ eligible: [ticketOf({ number: 70 })] });

		await drain();
		relay.close();

		expect(mockSetTicketStatus).toHaveBeenCalledWith({
			settings: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey: 'lin_key' },
			ticketId: 'id-70',
			statusName: 'In Progress',
		});
	});

	test('settles the parked label with the tracker identity, and with the label the queue block still owns', async () => {
		const { drain, relay } = setupDrain({ eligible: [ticketOf({ number: 70 })] });

		await drain({ settings: queueSettingsFixture({ parkedLabel: 'queue-parked' }) });
		relay.close();

		expect(mockSetParkedLabel).toHaveBeenCalledWith({
			settings: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey: 'lin_key' },
			ticketId: 'id-70',
			label: 'queue-parked',
			parked: false,
		});
	});

	test('reads the tickets behind the parked worktrees with the tracker identity too, so a resume needs no queue-side key', async () => {
		const { drain, relay } = setupDrain({ parkedTicket: ticketOf({ number: 99 }), parkedBranch: 'lo-99-parked' });

		await drain();
		relay.close();

		expect(mockGetTicketsByIdentifiers).toHaveBeenCalledWith({
			settings: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey: 'lin_key' },
			identifiers: ['lo-99'],
		});
	});

	test('re-reads the backlog for a later wave with the same tracker identity the first read used', async () => {
		const { drain, relay } = setupDrain();

		mockListTickets.mockResolvedValueOnce([ticketOf({ number: 70 }), ticketOf({ number: 71, unfinishedBlockers: ['LO-69'] })]);

		await drain();
		relay.close();

		expect(mockListTickets.mock.calls.map(([params]) => params.settings)).toStrictEqual([
			{ provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey: 'lin_key' },
			{ provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey: 'lin_key' },
		]);
	});

	test('hands Jira identity through unchanged while queue policy stays provider-neutral', async () => {
		const { drain, relay } = setupDrain();
		const trackerSettings = jiraTrackerSettingsFixture();

		await drain({ trackerSettings });
		relay.close();

		expect(mockListTickets).toHaveBeenCalledWith({
			settings: trackerSettings,
			labelNames: ['route-direct', 'route-auto-plan'],
			statuses: ['Backlog'],
		});
	});

	test('shapes its startup sample from the tracker prefix, so a ticket pattern scoped to that provider starts the drain', async () => {
		const { drain, relay } = setupDrain();

		const report = await drain({
			trackerSettings: trackerSettingsFixture({ ticketPrefix: 'ENG', team: 'ENG' }),
			ship: shipSettingsFixture({ ticketPattern: /^(?<ticket>eng-\d+)/ }),
		});

		relay.close();

		expect(report).toStrictEqual({ outcomes: [], leftBehind: [] });
	});

	test('refuses before reading the tracker when the ship pattern is scoped to a different prefix than the tracker block names', async () => {
		const { drain, relay } = setupDrain();

		const report = await drain({
			trackerSettings: trackerSettingsFixture({ ticketPrefix: 'ENG', team: 'ENG' }),
			ship: shipSettingsFixture({ ticketPattern: /^(?<ticket>lo-\d+)/ }),
		});

		relay.close();

		expect(report).toEqual({ error: expect.stringContaining('eng-1') });
		expect(mockListTickets).not.toHaveBeenCalled();
	});
});
