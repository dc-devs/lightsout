import { describe, expect, jest, test } from '@jest/globals';
import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WorkOrderRunOutcome } from '#src/queue/common/types/WorkOrderRunOutcome.ts';
import type { ParkedWork } from '#src/queue/internal/common/types/ParkedWork.ts';
import type { nameWaveWorkOrders } from '#src/queue/nameWaveWorkOrders.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { nameWaveLikeTemplate } from '#tests/helpers/nameWaveLikeTemplate.ts';
import { queueOutcomeFixture as outcomeOf } from '#tests/helpers/queueOutcomeFixture.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { queueTicketFixture as ticketOf } from '#tests/helpers/queueTicketFixture.ts';
import { setupQueueDrain } from '#tests/helpers/setupQueueDrain.ts';

// Mocked Imports
// -------------------------
// The park label is opt-in, written after the serial merge, and never a
// precondition for building — three claims about WHEN the drain writes it and
// over WHICH list, which is why this file stubs the write itself. What the
// write does to a tracker is `setTicketLabel`'s own test.
type LabelParams = { settings: TrackerSettings; ticketId: string; label: string | undefined; present: boolean };

const mockListEligibleTickets = jest.fn<() => Promise<TicketSummary[] | QueueFailure>>();
const mockScanParkedWorktrees = jest.fn<() => Promise<ParkedWork | QueueFailure>>();
const mockRunQueueTicket = jest.fn<(params: { workOrder: NamedWorkOrder }) => Promise<WorkOrderRunOutcome>>();
const mockShipOneBranch = jest.fn<(params: { outcome: WorkOrderRunOutcome }) => Promise<WorkOrderRunOutcome>>();
const mockSetTicketLabel = jest.fn<(params: LabelParams) => Promise<QueueFailure | undefined>>();

jest.mock('#src/queue/ticketSelection/listEligibleTickets.ts', () => ({ listEligibleTickets: () => mockListEligibleTickets() }));
jest.mock('#src/ticketTracker/appendTicketNote.ts', () => ({ appendTicketNote: () => Promise.resolve(undefined) }));
jest.mock('#src/ticketTracker/listLabelNames.ts', () => ({
	listLabelNames: () =>
		Promise.resolve(['planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan', 'planning-complete', 'planning-not-needed']),
}));
jest.mock('#src/ticketTracker/setTicketLabel.ts', () => ({ setTicketLabel: (params: LabelParams) => mockSetTicketLabel(params) }));
jest.mock('#src/queue/worktrees/scanParkedWorktrees.ts', () => ({ scanParkedWorktrees: () => mockScanParkedWorktrees() }));
jest.mock('#src/queue/internal/runQueueWorkOrder.ts', () => ({ runQueueWorkOrder: (params: { workOrder: NamedWorkOrder }) => mockRunQueueTicket(params) }));
jest.mock('#src/queue/internal/shipOneBranch.ts', () => ({ shipOneBranch: (params: { outcome: WorkOrderRunOutcome }) => mockShipOneBranch(params) }));
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

/** A repo with a remote behind it and every collaborator stubbed green. */
const setupDrain = ({ eligible = [] }: { eligible?: TicketSummary[] } = {}) => {
	mockListEligibleTickets.mockResolvedValue(eligible);
	mockScanParkedWorktrees.mockResolvedValue({ resumed: [], outcomes: [], leftBehind: [], merged: [] });
	mockRunQueueTicket.mockImplementation(({ workOrder: { ticket } }) => Promise.resolve(outcomeOf({ ticket })));
	mockShipOneBranch.mockImplementation(({ outcome }) => Promise.resolve(outcome));
	mockSetTicketLabel.mockResolvedValue(undefined);

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

		expect(mockSetTicketLabel.mock.calls.map(([params]) => ({ ticketId: params.ticketId, label: params.label, present: params.present }))).toStrictEqual([
			{ ticketId: 'id-70', label: 'queue-parked', present: false },
			{ ticketId: 'id-71', label: 'queue-parked', present: true },
		]);
	});

	test('reports a failed label write as progress and still hands the drain back, because the tracker is never a precondition for building', async () => {
		const { drain, relay, progress } = setupDrain({ eligible: [ticketOf({ number: 70 })] });

		mockSetTicketLabel.mockResolvedValue({ error: 'there is no LO team to create the label on' });

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

		expect(mockSetTicketLabel).not.toHaveBeenCalled();
	});
});
