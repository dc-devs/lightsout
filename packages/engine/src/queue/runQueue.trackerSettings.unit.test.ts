import { execSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import type { TrackerFailure, TrackerSettings, TrackerTicket } from '#src/ticketTracker/index.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { setupQueueDrain } from '#tests/helpers/setupQueueDrain.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
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
type LabelParams = { settings: TrackerSettings; ticketId: string; label: string | undefined; present: boolean };

const mockListTickets = jest.fn<(params: ListTicketsParams) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockGetTicketsByIdentifiers = jest.fn<(params: IdentifiersParams) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockSetTicketStatus = jest.fn<(params: StatusParams) => Promise<TrackerFailure | undefined>>();
const mockSetTicketLabel = jest.fn<(params: LabelParams) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	listLabelNames: () =>
		Promise.resolve(['planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan', 'planning-complete', 'planning-not-needed']),
	appendTicketNote: () => Promise.resolve(undefined),
	getTicketsByIdentifiers: (params: IdentifiersParams) => mockGetTicketsByIdentifiers(params),
	listTickets: (params: ListTicketsParams) => mockListTickets(params),
	setTicketLabel: (params: LabelParams) => mockSetTicketLabel(params),
	setTicketStatus: (params: StatusParams) => mockSetTicketStatus(params),
}));
// -------------------------
// The three steps that would spend real time on a machine: cutting a worktree,
// running a harness, and merging. Each is covered by its own tests, and none of
// them reads tracker identity.
const mockCreateWorktree = jest.fn<(params: { cwd: string; branch: string }) => Promise<string | QueueFailure>>();

jest.mock('#src/worktree/createWorktree.ts', () => ({
	createWorktree: (params: { cwd: string; branch: string }) => mockCreateWorktree(params),
}));
// -------------------------
const mockRunWorkerWithRelay = jest.fn<() => Promise<WorkerOutcome>>();

jest.mock('#src/queue/workers/runWorkerWithRelay.ts', () => ({ runWorkerWithRelay: () => mockRunWorkerWithRelay() }));
// -------------------------
jest.mock('#src/queue/commitTicketWork.ts', () => ({ commitTicketWork: () => Promise.resolve({ committed: true }) }));
// -------------------------
// The branch's commit count, which decides readiness. Its own tests own what git
// answers; here the branch is simply finished, so the drain reaches the ship
// step and the parked label settles the way this file asserts.
jest.mock('#src/common/git/readGitCommitsAhead.ts', () => ({ readGitCommitsAhead: () => Promise.resolve(1) }));
// -------------------------
const mockShipOneBranch = jest.fn<(params: { outcome: TicketRunOutcome }) => Promise<TicketRunOutcome>>();

jest.mock('#src/queue/shipOneBranch.ts', () => ({ shipOneBranch: (params: { outcome: TicketRunOutcome }) => mockShipOneBranch(params) }));
// -------------------------

const ticketOf = ({
	number,
	labels = ['planning-not-needed'],
	status = 'Ready to implement',
	unfinishedBlockers = [],
}: {
	number: number;
	labels?: string[];
	status?: string;
	unfinishedBlockers?: string[];
}): TrackerTicket => ({
	id: `id-${number}`,
	identifier: `LO-${number}`,
	title: `Ticket ${number}`,
	url: `https://linear.app/lightsout/issue/LO-${number}`,
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels,
	status,
	finished: false,
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
	mockSetTicketLabel.mockResolvedValue(undefined);
	mockCreateWorktree.mockImplementation(({ branch }) => Promise.resolve(join(worktreesRoot, branch)));
	mockRunWorkerWithRelay.mockResolvedValue({});
	mockShipOneBranch.mockImplementation(({ outcome }) => Promise.resolve(outcome));

	return setupQueueDrain({ cwd });
};

describe('runQueue', () => {
	test('reads the backlog with the resolved tracker identity, and with the planning status labels and statuses the queue block still owns', async () => {
		const { drain, relay } = setupDrain();

		await drain();
		relay.close();

		expect(mockListTickets).toHaveBeenCalledWith({
			settings: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey: 'lin_key' },
			labelNames: ['planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan', 'planning-complete', 'planning-not-needed'],
			statuses: ['Backlog', 'Ready to implement'],
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

		expect(mockSetTicketLabel).toHaveBeenCalledWith({
			settings: { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey: 'lin_key' },
			ticketId: 'id-70',
			label: 'queue-parked',
			present: false,
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
			labelNames: ['planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan', 'planning-complete', 'planning-not-needed'],
			statuses: ['Backlog', 'Ready to implement'],
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
