import { describe, expect, jest, test } from '@jest/globals';
import { listEligibleTickets } from '#src/queue/listEligibleTickets.ts';
import type { TrackerFailure, TrackerTicket } from '#src/ticketTracker/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The seam is stubbed so no client is built. What this file owns is the labels
// and statuses the queue asks for, and the planning statuses it reads back out
// of the labels the seam reported.
type ListParams = { labelNames: string[]; statuses: string[] };

const mockListTickets = jest.fn<(params: ListParams) => Promise<TrackerTicket[] | TrackerFailure>>();

jest.mock('#src/ticketTracker/index.ts', () => ({ listTickets: (params: ListParams) => mockListTickets(params) }));
// -------------------------

const settings = queueSettingsFixture();
const trackerSettings = trackerSettingsFixture();

const ticketOf = ({ number, labels, status = 'Backlog' }: { number: number; labels: string[]; status?: string }): TrackerTicket => ({
	id: `id-${number}`,
	identifier: `LO-${number}`,
	title: `Ticket ${number}`,
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels,
	status,
	unfinishedBlockers: [],
});

describe('listEligibleTickets', () => {
	test('asks the seam for every configured planning status label and every eligible status in one go', async () => {
		mockListTickets.mockResolvedValue([]);

		await listEligibleTickets({ settings, trackerSettings });

		expect(mockListTickets).toHaveBeenCalledWith(
			expect.objectContaining({
				labelNames: ['planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan', 'planning-complete', 'planning-not-needed'],
				statuses: ['Backlog', 'Ready to implement'],
			}),
		);
	});

	test('reads the planning status out of the label the ticket carries, and the worker out of the pair it makes with the status', async () => {
		mockListTickets.mockResolvedValue([
			ticketOf({ number: 70, labels: ['planning-not-needed'], status: 'Ready to implement' }),
			ticketOf({ number: 71, labels: ['planning-complete', 'bug'], status: 'Ready to implement' }),
			ticketOf({ number: 72, labels: ['planning-ready-auto-plan'] }),
		]);

		expect(await listEligibleTickets({ settings, trackerSettings })).toEqual([
			expect.objectContaining({ identifier: 'LO-70', planningStatus: 'planning-not-needed', worker: 'direct' }),
			expect.objectContaining({ identifier: 'LO-71', planningStatus: 'planning-complete', worker: 'plan' }),
			expect.objectContaining({ identifier: 'LO-72', planningStatus: 'planning-ready-auto-plan', worker: 'auto-plan' }),
		]);
	});

	test('leaves the worker unset on a pair the queue does not take, so the drain drops it rather than guessing one', async () => {
		mockListTickets.mockResolvedValue([ticketOf({ number: 70, labels: ['planning-needs-plan'] }), ticketOf({ number: 71, labels: ['planning-not-needed'] })]);

		expect(await listEligibleTickets({ settings, trackerSettings })).toEqual([
			expect.objectContaining({ identifier: 'LO-70', worker: undefined }),
			expect.objectContaining({ identifier: 'LO-71', worker: undefined }),
		]);
	});

	test('answers one summary per planning status label a ticket carrying two has, leaving the skip policy to the drain', async () => {
		mockListTickets.mockResolvedValue([ticketOf({ number: 70, labels: ['planning-complete', 'planning-not-needed'], status: 'Ready to implement' })]);

		expect(await listEligibleTickets({ settings, trackerSettings })).toEqual([
			expect.objectContaining({ identifier: 'LO-70', planningStatus: 'planning-complete' }),
			expect.objectContaining({ identifier: 'LO-70', planningStatus: 'planning-not-needed' }),
		]);
	});

	test('answers nothing for a ticket carrying no configured planning status label — nothing delegated it', async () => {
		mockListTickets.mockResolvedValue([ticketOf({ number: 70, labels: ['bug'] })]);

		expect(await listEligibleTickets({ settings, trackerSettings })).toStrictEqual([]);
	});

	test('hands a tracker failure back rather than swallowing it — a bad key must not read as an empty backlog', async () => {
		mockListTickets.mockResolvedValue({ error: 'authentication failed' });

		expect(await listEligibleTickets({ settings, trackerSettings })).toStrictEqual({ error: 'authentication failed' });
	});
});
