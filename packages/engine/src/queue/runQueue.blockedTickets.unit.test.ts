import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { ParkedWork } from '#src/queue/common/types/ParkedWork.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { queueOutcomeFixture as outcomeOf } from '#tests/helpers/queueOutcomeFixture.ts';
import { queueTicketFixture as ticketOf } from '#tests/helpers/queueTicketFixture.ts';
import { setupQueueDrain } from '#tests/helpers/setupQueueDrain.ts';

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
const mockShipOneBranch = jest.fn<(params: { outcome: TicketRunOutcome }) => Promise<TicketRunOutcome>>();
type LabelParams = { settings: TrackerSettings; ticketId: string; label: string | undefined; parked: boolean };

const mockSetParkedLabel = jest.fn<(params: LabelParams) => Promise<QueueFailure | undefined>>();

jest.mock('#src/queue/ticketSelection/listEligibleTickets.ts', () => ({ listEligibleTickets: () => mockListEligibleTickets() }));
jest.mock('#src/ticketTracker/index.ts', () => ({
	listLabelNames: () =>
		Promise.resolve(['planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan', 'planning-complete', 'planning-not-needed']),
	appendTicketNote: () => Promise.resolve(undefined),
	setParkedLabel: (params: LabelParams) => mockSetParkedLabel(params),
}));
jest.mock('#src/queue/worktrees/scanParkedWorktrees.ts', () => ({ scanParkedWorktrees: () => mockScanParkedWorktrees() }));
jest.mock('#src/queue/runQueueTicket.ts', () => ({ runQueueTicket: (params: { ticket: TicketSummary }) => mockRunQueueTicket(params) }));
jest.mock('#src/queue/shipOneBranch.ts', () => ({ shipOneBranch: (params: { outcome: TicketRunOutcome }) => mockShipOneBranch(params) }));
// -------------------------

/** One eligible ticket; `unfinishedBlockers` is the only thing these tests vary, because it is what holds a ticket back. */

/** A ticket that ran green — every test here is about the tickets that never ran at all. */

/**
 * A repo with a remote behind it and every collaborator stubbed green.
 *
 * `eligible` is what EVERY tracker read answers; a test that needs the backlog
 * to change between scans queues the earlier answers with `mockResolvedValueOnce`
 * on top of it, which is what a blocker finishing mid-drain looks like here.
 */
const setupDrain = ({ eligible = [], parked }: { eligible?: TicketSummary[]; parked?: ParkedWork } = {}) => {
	mockListEligibleTickets.mockResolvedValue(eligible);
	mockScanParkedWorktrees.mockResolvedValue(parked ?? { resumed: [], outcomes: [], leftBehind: [], merged: [] });
	mockRunQueueTicket.mockImplementation(({ ticket }) => Promise.resolve(outcomeOf({ ticket })));
	mockShipOneBranch.mockImplementation(({ outcome }) => Promise.resolve(outcome));
	mockSetParkedLabel.mockResolvedValue(undefined);

	return setupQueueDrain();
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
		const { drain, relay } = setupDrain({
			parked: { resumed: [ticketOf({ number: 99, unfinishedBlockers: ['LO-69'] })], outcomes: [], leftBehind: [], merged: [] },
		});

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
