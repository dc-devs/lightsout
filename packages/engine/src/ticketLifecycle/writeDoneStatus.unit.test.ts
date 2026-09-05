import { beforeEach, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { TrackerStatusRole } from '#src/ticketLifecycle/common/constants/TrackerStatusRole.ts';
import type { LifecycleSettings } from '#src/ticketLifecycle/common/types/LifecycleSettings.ts';
import { writeDoneStatus } from '#src/ticketLifecycle/writeDoneStatus.ts';
import type { TrackerFailure, TrackerSettings, TrackerTicket } from '#src/ticketTracker/index.ts';

// Mocked Imports
// -------------------------
// The write and the read are each covered by their own tests. What this file
// owns is the question they are used to answer: did the ticket reach Done.
interface LifecycleParams {
	ticketId: string;
	trackerStatus?: string;
	currentStatus?: string;
}

const mockUpdateTicketLifecycle = jest.fn<(params: LifecycleParams) => Promise<TrackerFailure | undefined>>();
const mockGetTicketsByIdentifiers = jest.fn<(params: { settings: TrackerSettings; identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();

jest.mock('#src/ticketLifecycle/updateTicketLifecycle.ts', () => ({
	updateTicketLifecycle: (params: LifecycleParams) => mockUpdateTicketLifecycle(params),
}));
jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketsByIdentifiers: (params: { settings: TrackerSettings; identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
}));
// -------------------------

const lifecycle: LifecycleSettings = {
	planningStatusLabels: {
		[PlanningStatus.NeedsBrainstorm]: 'planning-needs-brainstorm',
		[PlanningStatus.NeedsPlan]: 'planning-needs-plan',
		[PlanningStatus.ReadyAutoPlan]: 'planning-ready-auto-plan',
		[PlanningStatus.Complete]: 'planning-complete',
		[PlanningStatus.NotNeeded]: 'planning-not-needed',
	},
	statusNames: {
		[TrackerStatusRole.Ready]: 'Ready to Implement',
		[TrackerStatusRole.InProgress]: 'In Progress',
		[TrackerStatusRole.Done]: 'Done',
	},
	eligibleStatuses: ['Backlog', 'Ready to Implement'],
};

const trackerSettings: TrackerSettings = { provider: 'linear', ticketPrefix: 'LO', team: 'LO', apiKey: 'key' };

const ticketAt = ({ status }: { status: string }): TrackerTicket => ({
	id: 'internal-id',
	identifier: 'LO-79',
	title: 'Workers commit generated files',
	description: '',
	priority: 2,
	createdAt: '2026-08-30T22:40:41.813Z',
	labels: [],
	status,
	unfinishedBlockers: [],
});

const settle = async () => writeDoneStatus({ lifecycle, trackerSettings, ticketId: 'internal-id', ticketRef: 'LO-79', currentStatus: 'In Progress' });

beforeEach(() => {
	mockUpdateTicketLifecycle.mockReset();
	mockGetTicketsByIdentifiers.mockReset();
});

test('writeDoneStatus: a write that lands asks the tracker nothing further', async () => {
	mockUpdateTicketLifecycle.mockResolvedValue(undefined);

	expect(await settle()).toBe(undefined);
	expect(mockUpdateTicketLifecycle).toHaveBeenCalledTimes(1);
	expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
});

test('writeDoneStatus: a write reported as failed that actually landed is success, because the deadline cancelled nothing', async () => {
	mockUpdateTicketLifecycle.mockResolvedValue({ error: 'the tracker did not answer within 60000ms' });
	mockGetTicketsByIdentifiers.mockResolvedValue([ticketAt({ status: 'Done' })]);

	expect(await settle()).toBe(undefined);
	// read back rather than written again: the ticket was already where it belongs
	expect(mockUpdateTicketLifecycle).toHaveBeenCalledTimes(1);
});

test('writeDoneStatus: a ticket that genuinely did not move is written a second time', async () => {
	mockUpdateTicketLifecycle.mockResolvedValueOnce({ error: 'the tracker did not answer within 60000ms' }).mockResolvedValueOnce(undefined);
	mockGetTicketsByIdentifiers.mockResolvedValue([ticketAt({ status: 'In Progress' })]);

	expect(await settle()).toBe(undefined);
	expect(mockUpdateTicketLifecycle).toHaveBeenCalledTimes(2);
	// the status just read, not the stale one the caller passed in
	expect(mockUpdateTicketLifecycle).toHaveBeenLastCalledWith(expect.objectContaining({ currentStatus: 'In Progress', trackerStatus: TrackerStatusRole.Done }));
});

test('writeDoneStatus: a second write that fails too reports that second reason', async () => {
	mockUpdateTicketLifecycle
		.mockResolvedValueOnce({ error: 'the tracker did not answer within 60000ms' })
		.mockResolvedValueOnce({ error: "no transition to 'Done' is available" });
	mockGetTicketsByIdentifiers.mockResolvedValue([ticketAt({ status: 'In Progress' })]);

	expect(await settle()).toBe("no transition to 'Done' is available");
});

test('writeDoneStatus: a ticket that cannot be read back reports both reasons, so neither is hidden', async () => {
	mockUpdateTicketLifecycle.mockResolvedValue({ error: 'the tracker did not answer within 60000ms' });
	mockGetTicketsByIdentifiers.mockResolvedValue({ error: 'unauthorized' });

	const reason = await settle();

	expect(reason).toContain('the tracker did not answer within 60000ms');
	expect(reason).toContain('unauthorized');
	expect(mockUpdateTicketLifecycle).toHaveBeenCalledTimes(1);
});

test('writeDoneStatus: a tracker that returns no ticket is written a second time rather than assumed done', async () => {
	mockUpdateTicketLifecycle.mockResolvedValueOnce({ error: 'the tracker did not answer within 60000ms' }).mockResolvedValueOnce(undefined);
	mockGetTicketsByIdentifiers.mockResolvedValue([]);

	expect(await settle()).toBe(undefined);
	expect(mockUpdateTicketLifecycle).toHaveBeenCalledTimes(2);
});
