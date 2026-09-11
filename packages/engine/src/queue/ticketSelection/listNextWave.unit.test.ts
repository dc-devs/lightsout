import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { GateHolds } from '#src/gates/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { listEligibleTickets } from '#src/queue/ticketSelection/listEligibleTickets.ts';
import { listNextWave } from '#src/queue/ticketSelection/listNextWave.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The tracker re-read is stubbed so this file owns one question only: whether
// the holds it was handed reach the selection that refuses a held ticket.
const mockListEligibleTickets = jest.fn<typeof listEligibleTickets>();

jest.mock('#src/queue/ticketSelection/listEligibleTickets.ts', () => ({
	listEligibleTickets: (params: Parameters<typeof listEligibleTickets>[0]) => mockListEligibleTickets(params),
}));
// -------------------------

const settings = queueSettingsFixture();
const trackerSettings = trackerSettingsFixture();

const holdReason = 'the gates never got the machine within the wait ceiling';

const ticketOf = ({ number }: { number: number }): TicketSummary => ({
	id: `id-${number}`,
	identifier: `LO-${number}`,
	title: `Ticket ${number}`,
	url: `https://linear.app/lightsout/issue/LO-${number}`,
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus: PlanningStatus.NotNeeded,
	worker: QueueWorker.Direct,
	status: 'Ready to implement',
	finished: false,
	unfinishedBlockers: [],
});

const setupRescan = () => {
	mockListEligibleTickets.mockResolvedValue([ticketOf({ number: 70 }), ticketOf({ number: 71 })]);

	const holds: GateHolds = {
		'lo-70': {
			takenAt: '2026-01-02T03:04:05.000Z',
			runId: 'run-42',
			worktreePath: '/tmp/worktrees/lo-70',
			reason: holdReason,
			labelConfirmed: true,
		},
	};

	return { holds };
};

const setupFailedRead = () => {
	mockListEligibleTickets.mockResolvedValue({ error: 'linear refused the read: token expired' });

	return { holds: {} satisfies GateHolds };
};

describe('listNextWave', () => {
	test('refuses a held ticket on a re-scan', async () => {
		const { holds } = setupRescan();

		const selection = await listNextWave({ settings, trackerSettings, attempted: new Set<string>(), holds });

		expect(selection).toEqual(
			expect.objectContaining({
				runnable: [expect.objectContaining({ identifier: 'LO-71' })],
				blocked: [{ identifier: 'LO-70', title: 'Ticket 70', url: 'https://linear.app/lightsout/issue/LO-70', reason: expect.stringContaining(holdReason) }],
			}),
		);
	});

	test('answers the tracker failure unchanged rather than a wave, so a failed re-read never reads as an empty backlog', async () => {
		const { holds } = setupFailedRead();

		const selection = await listNextWave({ settings, trackerSettings, attempted: new Set<string>(), holds });

		expect(selection).toStrictEqual({ error: 'linear refused the read: token expired' });
	});
});
