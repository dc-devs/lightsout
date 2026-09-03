import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { ParkedWork } from '#src/queue/common/types/ParkedWork.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { runQueue } from '#src/queue/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { terminalRelayFixture } from '#tests/helpers/terminalRelayFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// What the drain's report says about a ticket it never worked: one held back by
// an unfinished blocker, one carrying two planning status labels at once. A blocker
// finishing mid-drain is expressed by the tracker stub answering a DIFFERENT
// eligible list on the next call, which is why the same stubs the wave suite
// builds are what this file needs too.
const mockListEligibleTickets = jest.fn<() => Promise<TicketSummary[] | QueueFailure>>();
const mockScanParkedWorktrees = jest.fn<() => Promise<ParkedWork | QueueFailure>>();
const mockRunQueueTicket = jest.fn<(params: { ticket: TicketSummary }) => Promise<TicketRunOutcome>>();
const mockShipReadyBranches = jest.fn<(params: { ready: TicketRunOutcome[] }) => Promise<TicketRunOutcome[]>>();
type LabelParams = { settings: TrackerSettings; ticketId: string; label: string | undefined; parked: boolean };

const mockSetParkedLabel = jest.fn<(params: LabelParams) => Promise<QueueFailure | undefined>>();

jest.mock('#src/queue/listEligibleTickets.ts', () => ({ listEligibleTickets: () => mockListEligibleTickets() }));
jest.mock('#src/ticketTracker/index.ts', () => ({
	listLabelNames: () =>
		Promise.resolve(['planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan', 'planning-complete', 'planning-not-needed']),
	appendTicketNote: () => Promise.resolve(undefined),
	setParkedLabel: (params: LabelParams) => mockSetParkedLabel(params),
}));
jest.mock('#src/queue/scanParkedWorktrees.ts', () => ({ scanParkedWorktrees: () => mockScanParkedWorktrees() }));
jest.mock('#src/queue/runQueueTicket.ts', () => ({ runQueueTicket: (params: { ticket: TicketSummary }) => mockRunQueueTicket(params) }));
jest.mock('#src/queue/shipReadyBranches.ts', () => ({ shipReadyBranches: (params: { ready: TicketRunOutcome[] }) => mockShipReadyBranches(params) }));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };
const shipSettings = shipSettingsFixture();

/** One eligible ticket; `unfinishedBlockers` is the only thing these tests vary, because it is what holds a ticket back. */
const ticketOf = ({ number, unfinishedBlockers = [] }: { number: number; unfinishedBlockers?: string[] }): TicketSummary => ({
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
	unfinishedBlockers,
});

/** A ticket that ran green — every test here is about the tickets that never ran at all. */
const outcomeOf = ({ ticket }: { ticket: TicketSummary }): TicketRunOutcome => ({
	ticket,
	branch: `${ticket.identifier.toLowerCase()}-ticket-${ticket.id}`,
	worktreePath: `/tmp/worktrees/${ticket.identifier}`,
	ready: true,
});

/**
 * A repo with a remote behind it and every collaborator stubbed green.
 *
 * `eligible` is what EVERY tracker read answers; a test that needs the backlog
 * to change between scans queues the earlier answers with `mockResolvedValueOnce`
 * on top of it, which is what a blocker finishing mid-drain looks like here.
 */
const setupDrain = ({ eligible = [], parked }: { eligible?: TicketSummary[]; parked?: ParkedWork } = {}) => {
	const { cwd } = setupBranchRepo();

	execSync('git config user.name t && git config user.email t@t', { cwd, stdio: 'ignore' });
	mockListEligibleTickets.mockResolvedValue(eligible);
	mockScanParkedWorktrees.mockResolvedValue(parked ?? { resumed: [], outcomes: [], leftBehind: [] });
	mockRunQueueTicket.mockImplementation(({ ticket }) => Promise.resolve(outcomeOf({ ticket })));
	mockShipReadyBranches.mockImplementation(({ ready }) => Promise.resolve(ready));
	mockSetParkedLabel.mockResolvedValue(undefined);

	const relay = terminalRelayFixture();
	const progress: string[] = [];

	const drain = ({ settings = queueSettingsFixture() }: { settings?: QueueSettings } = {}) =>
		runQueue({
			cwd,
			settings,
			trackerSettings: trackerSettingsFixture(),
			shipSettings,
			config,
			env: {},
			driver,
			driverName: 'claude-code',
			relay,
			onProgress: (message) => progress.push(message),
		});

	return { cwd, drain, relay, progress };
};

/** The identifiers handed to a worker, in the order the drain picked them up. */
const pickedUp = () => mockRunQueueTicket.mock.calls.map((call) => call[0].ticket.identifier);

describe('runQueue', () => {
	test('never spends a worker on a blocked ticket, and names the blocker once in the report', async () => {
		const { drain, relay } = setupDrain({ eligible: [ticketOf({ number: 70 }), ticketOf({ number: 71, unfinishedBlockers: ['LO-69'] })] });

		const report = await drain();

		relay.close();

		expect(pickedUp()).toStrictEqual(['LO-70']);
		expect(report).toEqual({
			outcomes: [expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-70' }) })],
			leftBehind: [{ identifier: 'LO-71', reason: expect.stringContaining('blocked by LO-69') }],
		});
	});

	test('names a ticket the last scan skipped for two planning status labels beside the one still waiting on a blocker', async () => {
		const { drain, relay } = setupDrain();

		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 70 }), ticketOf({ number: 71, unfinishedBlockers: ['LO-69'] })]);
		mockListEligibleTickets.mockResolvedValueOnce([
			ticketOf({ number: 71, unfinishedBlockers: ['LO-69'] }),
			ticketOf({ number: 80 }),
			{ ...ticketOf({ number: 80 }), planningStatus: PlanningStatus.Complete, worker: QueueWorker.Plan },
		]);

		const report = await drain();

		relay.close();

		expect(pickedUp()).toStrictEqual(['LO-70']);
		expect(report).toEqual({
			outcomes: [expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-70' }) })],
			leftBehind: [
				{ identifier: 'LO-80', reason: expect.stringContaining('planning status labels') },
				{ identifier: 'LO-71', reason: expect.stringContaining('blocked by LO-69') },
			],
		});
	});

	test('takes no run lock at all when every eligible ticket is waiting on a blocker, and says so', async () => {
		const { cwd, drain, relay, progress } = setupDrain({ eligible: [ticketOf({ number: 70, unfinishedBlockers: ['LO-69'] })] });

		const report = await drain();

		relay.close();

		expect(report).toEqual({ outcomes: [], leftBehind: [{ identifier: 'LO-70', reason: expect.stringContaining('blocked by LO-69') }] });
		expect(progress).toContainEqual(expect.stringContaining('waiting on an unfinished blocker'));
		expect(existsSync(join(cwd, '.lightsout', 'runs'))).toBe(false);
	});

	test('names a blocked RESUMED ticket once, though no later scan returns it — the eligible query hides its in-progress status', async () => {
		const { drain, relay } = setupDrain({ parked: { resumed: [ticketOf({ number: 99, unfinishedBlockers: ['LO-69'] })], outcomes: [], leftBehind: [] } });

		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 70 })]);
		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 71 })]);

		const report = await drain();

		relay.close();

		expect(pickedUp()).toStrictEqual(['LO-70', 'LO-71']);
		expect(report).toEqual({
			outcomes: [
				expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-70' }) }),
				expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-71' }) }),
			],
			leftBehind: [{ identifier: 'LO-99', reason: expect.stringContaining('blocked by LO-69') }],
		});
	});
});
