import { describe, expect, jest, test } from '@jest/globals';
import { listEligibleTickets } from '#src/queue/listEligibleTickets.ts';
import type { TrackerFailure, TrackerTicket } from '#src/ticketTracker/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The seam is stubbed so no client is built. What this file owns is the labels
// and statuses the queue asks for, and the routes it reads back out of the
// labels the seam reported — which is also the coverage for `toRoutedSummaries`.
type ListParams = { labelNames: string[]; statuses: string[] };

const mockListTickets = jest.fn<(params: ListParams) => Promise<TrackerTicket[] | TrackerFailure>>();

jest.mock('#src/ticketTracker/index.ts', () => ({ listTickets: (params: ListParams) => mockListTickets(params) }));
// -------------------------

const settings = queueSettingsFixture({ eligibleStatuses: ['Backlog', 'Ready to implement'] });
const trackerSettings = trackerSettingsFixture();

const ticketOf = ({ number, labels }: { number: number; labels: string[] }): TrackerTicket => ({
	id: `id-${number}`,
	identifier: `LO-${number}`,
	title: `Ticket ${number}`,
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels,
	unfinishedBlockers: [],
});

describe('listEligibleTickets', () => {
	test('asks the seam for every configured route label and every eligible status in one go', async () => {
		mockListTickets.mockResolvedValue([]);

		await listEligibleTickets({ settings, trackerSettings });

		expect(mockListTickets).toHaveBeenCalledWith(
			expect.objectContaining({ labelNames: ['route-direct', 'route-auto-plan'], statuses: ['Backlog', 'Ready to implement'] }),
		);
	});

	test('reads the route out of the label the ticket carries, because a route is the queue’s word for a label', async () => {
		mockListTickets.mockResolvedValue([ticketOf({ number: 70, labels: ['route-direct'] }), ticketOf({ number: 71, labels: ['route-auto-plan', 'bug'] })]);

		expect(await listEligibleTickets({ settings, trackerSettings })).toEqual([
			expect.objectContaining({ identifier: 'LO-70', route: 'direct' }),
			expect.objectContaining({ identifier: 'LO-71', route: 'auto-plan' }),
		]);
	});

	test('answers one summary per route label a ticket carrying both has, leaving the skip policy to the drain', async () => {
		mockListTickets.mockResolvedValue([ticketOf({ number: 70, labels: ['route-direct', 'route-auto-plan'] })]);

		expect(await listEligibleTickets({ settings, trackerSettings })).toEqual([
			expect.objectContaining({ identifier: 'LO-70', route: 'direct' }),
			expect.objectContaining({ identifier: 'LO-70', route: 'auto-plan' }),
		]);
	});

	test('answers nothing for a ticket carrying no configured route label — there is no route to send it down', async () => {
		mockListTickets.mockResolvedValue([ticketOf({ number: 70, labels: ['bug'] })]);

		expect(await listEligibleTickets({ settings, trackerSettings })).toStrictEqual([]);
	});

	test('hands a tracker failure back rather than swallowing it — a bad key must not read as an empty backlog', async () => {
		mockListTickets.mockResolvedValue({ error: 'authentication failed' });

		expect(await listEligibleTickets({ settings, trackerSettings })).toStrictEqual({ error: 'authentication failed' });
	});
});
