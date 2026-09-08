import { describe, expect, jest, test } from '@jest/globals';
import type { ParkedWork } from '#src/queue/common/types/ParkedWork.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { queueOutcomeFixture as outcomeOf } from '#tests/helpers/queueOutcomeFixture.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { queueTicketFixture as ticketOf } from '#tests/helpers/queueTicketFixture.ts';
import { setupQueueDrain } from '#tests/helpers/setupQueueDrain.ts';

// Mocked Imports
// -------------------------
// The park label is opt-in, written after the serial merge, and never a
// precondition for building — three claims about WHEN the drain writes it and
// over WHICH list, which is why this file stubs the write itself. What the
// write does to a tracker is `setParkedLabel`'s own test.
type LabelParams = { settings: TrackerSettings; ticketId: string; label: string | undefined; parked: boolean };

const mockListEligibleTickets = jest.fn<() => Promise<TicketSummary[] | QueueFailure>>();
const mockScanParkedWorktrees = jest.fn<() => Promise<ParkedWork | QueueFailure>>();
const mockRunQueueTicket = jest.fn<(params: { ticket: TicketSummary }) => Promise<TicketRunOutcome>>();
const mockShipOneBranch = jest.fn<(params: { outcome: TicketRunOutcome }) => Promise<TicketRunOutcome>>();
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

/** A repo with a remote behind it and every collaborator stubbed green. */
const setupDrain = ({ eligible = [] }: { eligible?: TicketSummary[] } = {}) => {
	mockListEligibleTickets.mockResolvedValue(eligible);
	mockScanParkedWorktrees.mockResolvedValue({ resumed: [], outcomes: [], leftBehind: [], merged: [] });
	mockRunQueueTicket.mockImplementation(({ ticket }) => Promise.resolve(outcomeOf({ ticket })));
	mockShipOneBranch.mockImplementation(({ outcome }) => Promise.resolve(outcome));
	mockSetParkedLabel.mockResolvedValue(undefined);

	return setupQueueDrain();
};

describe('runQueue', () => {
	test('settles the parked label over the outcomes shipping left behind, so a ticket that failed to merge is parked in the tracker too', async () => {
		const merged = ticketOf({ number: 70 });
		const unmerged = ticketOf({ number: 71 });
		const { drain, relay } = setupDrain({ eligible: [merged, unmerged] });

		const parked = outcomeOf({ ticket: unmerged, ready: false, error: 'the branch did not rebase onto main' });

		mockShipOneBranch.mockImplementation(({ outcome }) => Promise.resolve(outcome.ticket.identifier === unmerged.identifier ? parked : outcome));

		await drain({ settings: queueSettingsFixture({ parkedLabel: 'queue-parked' }) });
		relay.close();

		expect(mockSetParkedLabel.mock.calls.map(([params]) => ({ ticketId: params.ticketId, label: params.label, parked: params.parked }))).toStrictEqual([
			{ ticketId: 'id-70', label: 'queue-parked', parked: false },
			{ ticketId: 'id-71', label: 'queue-parked', parked: true },
		]);
	});

	test('reports a failed label write as progress and still hands the drain back, because the tracker is never a precondition for building', async () => {
		const { drain, relay, progress } = setupDrain({ eligible: [ticketOf({ number: 70 })] });

		mockSetParkedLabel.mockResolvedValue({ error: 'there is no LO team to create the label on' });

		const report = await drain({ settings: queueSettingsFixture({ parkedLabel: 'queue-parked' }) });

		relay.close();

		expect(report).toEqual({ outcomes: [expect.objectContaining({ ticket: expect.objectContaining({ identifier: 'LO-70' }), ready: true })], leftBehind: [] });
		expect(progress).toEqual([expect.stringContaining("LO-70 · the 'queue-parked' label could not be written")]);
	});

	test('leaves the tracker alone when no parked label is configured, because the label is opt-in', async () => {
		const parked = ticketOf({ number: 70 });
		const { drain, relay } = setupDrain({ eligible: [parked] });

		mockShipOneBranch.mockResolvedValue(outcomeOf({ ticket: parked, ready: false, error: 'the branch did not rebase onto main' }));

		await drain();
		relay.close();

		expect(mockSetParkedLabel).not.toHaveBeenCalled();
	});
});
