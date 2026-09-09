import { readFileSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import type { GateHolds } from '#src/gates/index.ts';
import { startScan } from '#src/queue/drainLanes/common/utils/startScan.ts';
import type { listNextWave, reconcileMergedTickets } from '#src/queue/ticketSelection/index.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { setupDrainLaneState } from '#tests/helpers/setupDrainLaneState.ts';

const mockScan = jest.fn<typeof listNextWave>();
const mockReconcile = jest.fn<typeof reconcileMergedTickets>();

jest.mock('#src/queue/ticketSelection/index.ts', () => ({
	listNextWave: (params: Parameters<typeof listNextWave>[0]) => mockScan(params),
	reconcileMergedTickets: (params: Parameters<typeof reconcileMergedTickets>[0]) => mockReconcile(params),
}));

const setupScan = () => {
	const lane = setupDrainLaneState();

	lane.state.blockedByIdentifier.set('lo-70', { identifier: 'LO-70', reason: 'blocked by LO-69' });
	mockScan.mockResolvedValue({ runnable: [], blocked: [], skipped: [] });
	mockReconcile.mockImplementation(async ({ tickets }) => ({ kept: tickets, leftBehind: [] }));

	return lane;
};

describe('startScan', () => {
	test('spends one idle scan, preserves missing blocked tickets, and does not poll an unchanged tracker', async () => {
		const lane = setupScan();

		startScan(lane);
		await Promise.all(lane.flight.tasks.values());
		lane.flight.tasks.clear();
		startScan(lane);

		expect(mockScan).toHaveBeenCalledTimes(1);
		expect(lane.state.blockedByIdentifier.get('lo-70')).toEqual({ identifier: 'LO-70', reason: 'blocked by LO-69' });
		expect(lane.flight.scans).toBe(0);
	});

	test('allows only one scan while builds are active and retains a later merge request', async () => {
		const lane = setupScan();

		lane.flight.builds = 1;
		lane.state.rescanRequested = true;
		startScan(lane);
		lane.state.rescanRequested = true;
		startScan(lane);

		expect(mockScan).toHaveBeenCalledTimes(1);
		expect(lane.flight.scans).toBe(1);
		expect(lane.state.rescanRequested).toBe(true);

		await Promise.all(lane.flight.tasks.values());
	});

	test.each(['no blockers', 'retired budget', 'stopped scans'] as const)('does not start a scan with %s', (reason) => {
		const lane = setupScan();

		lane.state.rescanRequested = true;
		if (reason === 'no blockers') lane.state.blockedByIdentifier.clear();
		if (reason === 'retired budget') lane.state.retired = 2;
		if (reason === 'stopped scans') lane.state.scansStopped = true;
		startScan(lane);

		expect(mockScan).not.toHaveBeenCalled();
		expect(lane.flight.tasks.size).toBe(0);
	});

	test('records a newly admitted ticket before its scan finishes and permits another idle scan', async () => {
		const lane = setupScan();
		const ticket = queueTicketFixture();

		mockScan.mockResolvedValue({ runnable: [ticket], blocked: [], skipped: [] });
		startScan(lane);
		await Promise.all(lane.flight.tasks.values());

		expect(lane.state.pending).toEqual([ticket]);
		expect(lane.state.idleScanSpent).toBe(false);
		expect(lane.state.blockedByIdentifier.size).toBe(0);
		expect(readFileSync(lane.context.planPath, 'utf8')).toContain('LO-70 · direct · lo-70-ticket-70');
		expect(lane.progress).toContain('LO-70 · joined the run already in flight');
	});

	test('hands the holds to the re-scan', async () => {
		const lane = setupScan();
		const holds: GateHolds = {
			'lo-70': {
				takenAt: '2026-01-01T00:00:00.000Z',
				runId: 'run-a1b2c3',
				worktreePath: '/tmp/lightsout/lo-70',
				reason: 'the gates never got the machine within the wait',
				labelConfirmed: true,
			},
		};

		startScan({ context: { ...lane.context, holds }, state: lane.state, flight: lane.flight });
		await Promise.all(lane.flight.tasks.values());

		expect(mockScan).toHaveBeenCalledWith(expect.objectContaining({ holds }));
	});

	test('settles a thrown tracker error, stops future scans, and explains the failure', async () => {
		const lane = setupScan();

		mockScan.mockRejectedValue(new Error('tracker offline'));
		startScan(lane);
		await Promise.all(lane.flight.tasks.values());

		expect(lane.state.scansStopped).toBe(true);
		expect(lane.flight.scans).toBe(0);
		expect(lane.progress).toEqual([expect.stringContaining('tracker offline')]);
		expect(lane.state.blockedByIdentifier.size).toBe(1);
	});
});
