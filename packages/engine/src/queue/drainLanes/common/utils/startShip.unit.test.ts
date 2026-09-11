import { describe, expect, jest, test } from '@jest/globals';
import { startShip } from '#src/queue/drainLanes/common/utils/startShip.ts';
import type { TicketRunOutcome } from '#src/queue/index.ts';
import type { shipOneBranch } from '#src/queue/shipOneBranch.ts';
import { queueOutcomeFixture } from '#tests/helpers/queueOutcomeFixture.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { setupDrainLaneState } from '#tests/helpers/setupDrainLaneState.ts';

const mockShip = jest.fn<typeof shipOneBranch>();

jest.mock('#src/queue/shipOneBranch.ts', () => ({ shipOneBranch: (params: Parameters<typeof shipOneBranch>[0]) => mockShip(params) }));

const setupShip = () => {
	const lane = setupDrainLaneState();
	const outcome = queueOutcomeFixture({ ticket: queueTicketFixture() });

	lane.state.readyToShip.push(outcome);
	mockShip.mockResolvedValue(outcome);

	return { ...lane, outcome };
};

/** A ready branch whose merge stays open until the test settles it, merged or rejected. */
const setupHeldShip = ({ settle }: { settle: 'merged' | 'rejected' }) => {
	const lane = setupShip();
	let settleMerge = (): void => undefined;
	const merge = new Promise<TicketRunOutcome>((resolve, reject) => {
		settleMerge = () => (settle === 'merged' ? resolve(lane.outcome) : reject(new Error('forge disconnected')));
	});

	mockShip.mockReturnValue(merge);

	return { ...lane, settleMerge };
};

describe('startShip', () => {
	test.each([
		{ builds: 2, ships: 0 },
		{ builds: 0, ships: 1 },
	])('leaves the ready branch queued while the budget is occupied: %j', ({ builds, ships }) => {
		const lane = setupShip();

		Object.assign(lane.flight, { builds, ships });
		startShip(lane);

		expect(mockShip).not.toHaveBeenCalled();
		expect(lane.state.readyToShip).toEqual([lane.outcome]);
		expect(lane.flight.tasks.size).toBe(0);
	});

	test('ships despite retired builder slots and requests a rescan only after the merge lands', async () => {
		const lane = setupShip();

		lane.state.retired = 2;
		lane.state.idleScanSpent = true;
		startShip(lane);

		expect(lane.flight.ships).toBe(1);
		expect(lane.state.rescanRequested).toBe(false);

		await Promise.all(lane.flight.tasks.values());

		expect(mockShip).toHaveBeenCalledWith(expect.objectContaining({ outcome: lane.outcome, serializeMainCheckout: lane.context.serializeMainCheckout }));
		expect(lane.state.outcomes).toEqual([lane.outcome]);
		expect(lane.state.rescanRequested).toBe(true);
		expect(lane.state.idleScanSpent).toBe(false);
		expect(lane.flight.ships).toBe(0);
	});

	test('hands the coordinator run id to the merge', async () => {
		const lane = setupShip();

		Object.assign(lane.context, { runId: 'coordinator-run-7' });
		startShip(lane);
		await Promise.all(lane.flight.tasks.values());

		expect(mockShip).toHaveBeenCalledWith(expect.objectContaining({ runId: 'coordinator-run-7', outcome: lane.outcome }));
	});

	test('parks a rejected merge without requesting a rescan or losing its worktree', async () => {
		const lane = setupShip();

		mockShip.mockRejectedValue(new Error('forge disconnected'));
		startShip(lane);
		await Promise.all(lane.flight.tasks.values());

		expect(lane.state.outcomes).toEqual([{ ...lane.outcome, ready: false, error: 'forge disconnected' }]);
		expect(lane.state.rescanRequested).toBe(false);
		expect(lane.flight.ships).toBe(0);
	});

	test.each([
		{ settle: 'merged' as const, settledAs: {} },
		{ settle: 'rejected' as const, settledAs: { ready: false, error: 'forge disconnected' } },
	])('holds the branch being merged in the shipping ledger until it settles', async ({ settle, settledAs }) => {
		const lane = setupHeldShip({ settle });

		startShip(lane);

		expect(lane.state.readyToShip).toEqual([]);
		expect(lane.state.shipping).toBe(lane.outcome);

		lane.settleMerge();
		await Promise.all(lane.flight.tasks.values());

		expect(lane.state.shipping).toBeUndefined();
		expect(lane.state.outcomes).toEqual([{ ...lane.outcome, ...settledAs }]);
	});
});
