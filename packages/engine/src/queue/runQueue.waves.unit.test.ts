import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
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
// The blocking half of the drain, which the base suite deliberately leaves
// alone: which tickets a wave may take and how often the tracker is re-read.
// What the report says about a ticket no wave ever worked is the neighbouring
// `runQueue.blockedTickets` suite. A blocker finishing mid-drain is expressed by
// the tracker stub answering a DIFFERENT eligible list on the next call.
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

const ticketOf = ({
	number,
	priority = 2,
	createdAt = '2026-01-01T00:00:00.000Z',
	unfinishedBlockers = [],
}: {
	number: number;
	priority?: number;
	createdAt?: string;
	unfinishedBlockers?: string[];
}): TicketSummary => ({
	id: `id-${number}`,
	identifier: `LO-${number}`,
	title: `Ticket ${number}`,
	description: '',
	priority,
	createdAt,
	labels: [],
	planningStatus: PlanningStatus.NotNeeded,
	worker: QueueWorker.Direct,
	status: 'Ready to implement',
	unfinishedBlockers,
});

const outcomeOf = ({
	ticket,
	ready = true,
	error,
	unanswered,
}: {
	ticket: TicketSummary;
	ready?: boolean;
	error?: string;
	unanswered?: boolean;
}): TicketRunOutcome => ({
	ticket,
	branch: `${ticket.identifier.toLowerCase()}-ticket-${ticket.id}`,
	worktreePath: `/tmp/worktrees/${ticket.identifier}`,
	ready,
	error,
	unanswered,
});

/**
 * A repo with a remote behind it and every collaborator stubbed green.
 *
 * `eligible` is what EVERY tracker read answers; a test that needs the backlog
 * to change between waves queues the earlier answers with `mockResolvedValueOnce`
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

/** The identifiers handed to a worker, in the order the waves picked them up. */
const pickedUp = () => mockRunQueueTicket.mock.calls.map((call) => call[0].ticket.identifier);

/** What each wave sent to the serial merge, one list per wave. */
const shippedPerWave = () => mockShipReadyBranches.mock.calls.map((call) => call[0].ready.map((outcome) => outcome.ticket.identifier));

/** The `queue.md` the one coordinator run wrote — one line per ticket any wave picked up. */
const readQueuePlan = ({ cwd }: { cwd: string }) => {
	const runsDir = join(cwd, '.lightsout', 'runs');
	const runId = readdirSync(runsDir)[0];

	return readFileSync(join(runsDir, runId, 'queue.md'), 'utf8');
};

describe('runQueue', () => {
	test('takes a ticket its blocker just unblocked in a later wave, and reports it only as an outcome', async () => {
		const { drain, relay } = setupDrain();

		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 70 }), ticketOf({ number: 71, unfinishedBlockers: ['LO-70'] })]);
		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 71 })]);

		const report = await drain();

		relay.close();

		expect(pickedUp()).toStrictEqual(['LO-70', 'LO-71']);
		expect(report).toEqual({
			outcomes: [
				expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-70' }) }),
				expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-71' }) }),
			],
			leftBehind: [],
		});
	});

	test('merges each wave before re-scanning, because a blocker only finishes once its branch is in', async () => {
		const { drain, relay } = setupDrain();

		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 70 }), ticketOf({ number: 71, unfinishedBlockers: ['LO-70'] })]);
		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 71 })]);

		await drain();
		relay.close();

		expect(shippedPerWave()).toStrictEqual([['LO-70'], ['LO-71']]);
	});

	test('merges a parked branch in the first wave only, so a later wave never ships settled work twice', async () => {
		const alreadyReady = outcomeOf({ ticket: ticketOf({ number: 99 }) });
		const { drain, relay } = setupDrain({ parked: { resumed: [], outcomes: [alreadyReady], leftBehind: [] } });

		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 70 }), ticketOf({ number: 71, unfinishedBlockers: ['LO-70'] })]);
		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 71 })]);

		const report = await drain();

		relay.close();

		expect(shippedPerWave()).toStrictEqual([['LO-99', 'LO-70'], ['LO-71']]);
		expect(report).toEqual({
			outcomes: [
				expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-99' }) }),
				expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-70' }) }),
				expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-71' }) }),
			],
			leftBehind: [],
		});
	});

	test('never re-runs a ticket the resume scan already finished, though a later scan hands it back', async () => {
		const alreadyReady = outcomeOf({ ticket: ticketOf({ number: 99 }) });
		const { drain, relay } = setupDrain({ parked: { resumed: [], outcomes: [alreadyReady], leftBehind: [] } });

		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 70 }), ticketOf({ number: 71, unfinishedBlockers: ['LO-70'] })]);
		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 99 }), ticketOf({ number: 71 })]);

		await drain();
		relay.close();

		expect(pickedUp()).toStrictEqual(['LO-70', 'LO-71']);
	});

	test('carries a worktree the resume scan left behind through every wave, and names it exactly once', async () => {
		const withdrawn = { identifier: 'LO-98', reason: 'its worktree is parked, but the ticket carries no planning status label any more' };
		const { drain, relay } = setupDrain({ parked: { resumed: [], outcomes: [], leftBehind: [withdrawn] } });

		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 70 }), ticketOf({ number: 71, unfinishedBlockers: ['LO-70'] })]);
		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 98 }), ticketOf({ number: 71 })]);

		const report = await drain();

		relay.close();

		expect(pickedUp()).toStrictEqual(['LO-70', 'LO-71']);
		expect(report).toEqual({
			outcomes: [
				expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-70' }) }),
				expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-71' }) }),
			],
			leftBehind: [withdrawn],
		});
	});

	test('stops re-reading the tracker once a scan turns up nothing newly runnable', async () => {
		const { drain, relay } = setupDrain({ eligible: [ticketOf({ number: 70 }), ticketOf({ number: 71, unfinishedBlockers: ['LO-69'] })] });

		await drain();
		relay.close();

		expect(mockListEligibleTickets).toHaveBeenCalledTimes(2);
	});

	test('reads the tracker exactly once when nothing in the backlog is blocked, as an unblocked drain always did', async () => {
		const { drain, relay } = setupDrain({ eligible: [ticketOf({ number: 70 }), ticketOf({ number: 71 })] });

		await drain();
		relay.close();

		expect(mockListEligibleTickets).toHaveBeenCalledTimes(1);
	});

	test('never offers a ticket a wave already worked to a later one, which is what makes the loop end', async () => {
		const { drain, relay } = setupDrain();

		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 70 }), ticketOf({ number: 71, unfinishedBlockers: ['LO-70'] })]);
		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 70 }), ticketOf({ number: 71 })]);

		await drain();
		relay.close();

		expect(pickedUp()).toStrictEqual(['LO-70', 'LO-71']);
	});

	test('never offers a ticket a full wave had no slot for to the next one, though the scan still lists it', async () => {
		const { drain, relay } = setupDrain();
		const firstScan = [ticketOf({ number: 70 }), ticketOf({ number: 71 }), ticketOf({ number: 72, unfinishedBlockers: ['LO-70'] })];

		mockListEligibleTickets.mockResolvedValueOnce(firstScan);
		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 71 }), ticketOf({ number: 72 })]);
		// LO-70 parks on an unanswered question — the one outcome that retires a
		// slot; a plain failure would free it and LO-71 would run after all.
		mockRunQueueTicket.mockImplementation(({ ticket }) =>
			Promise.resolve(outcomeOf({ ticket, ready: ticket.identifier !== 'LO-70', unanswered: ticket.identifier === 'LO-70' ? true : undefined })),
		);

		const report = await drain({ settings: queueSettingsFixture({ maxParallel: 1 }) });

		relay.close();

		expect(pickedUp()).toStrictEqual(['LO-70', 'LO-72']);
		expect(report).toEqual({
			outcomes: expect.arrayContaining([expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-72' }), ready: true })]),
			leftBehind: [{ identifier: 'LO-71', reason: expect.stringContaining('not started') }],
		});
	});

	test('works a later wave in priority order too, not in the order the tracker happened to list it', async () => {
		const { drain, relay } = setupDrain();

		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 70 }), ticketOf({ number: 71, unfinishedBlockers: ['LO-69'] })]);
		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 72, priority: 4 }), ticketOf({ number: 73, priority: 1 })]);

		await drain({ settings: queueSettingsFixture({ maxParallel: 1 }) });
		relay.close();

		expect(pickedUp()).toStrictEqual(['LO-70', 'LO-73', 'LO-72']);
	});

	test('scans the parked worktrees once for the whole invocation, so a parked ticket is never re-resumed to re-ask its question', async () => {
		const { drain, relay } = setupDrain();

		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 70 }), ticketOf({ number: 71, unfinishedBlockers: ['LO-70'] })]);
		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 71 })]);

		await drain();
		relay.close();

		expect(mockScanParkedWorktrees).toHaveBeenCalledTimes(1);
	});

	test('records every wave’s tickets in the coordinator run, not just the first wave’s', async () => {
		const { cwd, drain, relay } = setupDrain();

		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 70 }), ticketOf({ number: 71, unfinishedBlockers: ['LO-70'] })]);
		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 71 })]);

		await drain();
		relay.close();

		const plan = readQueuePlan({ cwd });

		expect(plan).toContain('LO-70 · direct · lo-70-ticket-70 ·');
		expect(plan).toContain('LO-71 · direct · lo-71-ticket-71 ·');
	});

	test('keeps the waves it already shipped when the re-scan itself fails, rather than throwing the drain away', async () => {
		const { drain, relay, progress } = setupDrain();

		mockListEligibleTickets.mockResolvedValueOnce([ticketOf({ number: 70 }), ticketOf({ number: 71, unfinishedBlockers: ['LO-69'] })]);
		mockListEligibleTickets.mockResolvedValueOnce({ error: 'the tracker did not answer' });

		const report = await drain();

		relay.close();

		expect(report).toEqual({
			outcomes: [expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-70' }) })],
			leftBehind: [{ identifier: 'LO-71', reason: expect.stringContaining('blocked by LO-69') }],
		});
		expect(progress).toContainEqual(expect.stringContaining('the re-scan for newly unblocked tickets failed'));
	});
});
