import { describe, expect, jest, test } from '@jest/globals';
import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';
import { admitScanned } from '#src/queue/drainLanes/common/utils/admitScanned.ts';
import type { nameWaveWorkOrders } from '#src/queue/nameWaveWorkOrders.ts';
import type { reconcileMergedTickets } from '#src/queue/ticketSelection/reconcileMergedTickets.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { setupDrainLaneState } from '#tests/helpers/setupDrainLaneState.ts';

// Mocked Imports
// -------------------------
const mockNameWave = jest.fn<typeof nameWaveWorkOrders>();

jest.mock('#src/queue/nameWaveWorkOrders.ts', () => ({
	nameWaveWorkOrders: (params: Parameters<typeof nameWaveWorkOrders>[0]) => mockNameWave(params),
}));
// -------------------------
const mockReconcile = jest.fn<typeof reconcileMergedTickets>();

jest.mock('#src/queue/ticketSelection/index.ts', () => ({
	reconcileMergedTickets: (params: Parameters<typeof reconcileMergedTickets>[0]) => mockReconcile(params),
}));
// -------------------------

const setupScan = () => {
	const built = setupDrainLaneState();
	/** Naming is mocked here, so the summariser's harness must never be spawned. */
	const context = { ...built.context, driver: createUncalledDriver({ reason: 'admitScanned spawned the harness itself' }) };
	const alpha = queueTicketFixture({ number: 70 });
	const merged = queueTicketFixture({ number: 71 });
	const unnamed = queueTicketFixture({ number: 72 });
	const alphaOrder: NamedWorkOrder = { ticket: alpha, name: 'lo-70-alpha', branch: 'feature/lo-70-alpha' };
	const mergedOrder: NamedWorkOrder = { ticket: merged, name: 'lo-71-merged', branch: 'feature/lo-71-merged' };
	const nameRefusal = { identifier: 'LO-72', reason: 'a work order named lo-72-other already exists' };
	const mergeSkip = { identifier: 'LO-71', reason: 'already merged', settled: true };
	const steps: string[] = [];

	mockNameWave.mockImplementation(async () => {
		steps.push('name');

		return { named: [alphaOrder, mergedOrder], leftBehind: [nameRefusal] };
	});
	mockReconcile.mockImplementation(async () => {
		steps.push('reconcile');

		return { kept: [alphaOrder], leftBehind: [mergeSkip] };
	});

	return { context, state: built.state, alpha, merged, unnamed, alphaOrder, mergedOrder, nameRefusal, mergeSkip, steps };
};

describe('admitScanned', () => {
	test('names the wave before reconciling merges, and settles what naming left behind', async () => {
		const { context, state, alpha, merged, unnamed, alphaOrder, mergedOrder, nameRefusal, mergeSkip, steps } = setupScan();
		const selection = { runnable: [alpha, merged, unnamed], blocked: [], skipped: [] };

		const admitted = await admitScanned({ context, state, selection });

		expect(steps).toEqual(['name', 'reconcile']);
		expect(mockNameWave).toHaveBeenCalledWith(expect.objectContaining({ cwd: context.cwd, driver: context.driver, tickets: [alpha, merged, unnamed] }));
		expect(mockReconcile).toHaveBeenCalledWith(expect.objectContaining({ tickets: [alphaOrder, mergedOrder] }));
		expect(admitted).toEqual([alphaOrder]);
		expect(state.pending).toEqual([alphaOrder]);
		expect(state.leftBehind).toEqual(expect.arrayContaining([nameRefusal, mergeSkip]));
		expect([...state.attempted].sort()).toEqual(['lo-70', 'lo-71', 'lo-72']);
	});
});
