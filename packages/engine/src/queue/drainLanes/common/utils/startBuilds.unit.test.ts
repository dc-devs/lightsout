import { describe, expect, test } from '@jest/globals';
import { startBuilds } from '#src/queue/drainLanes/common/utils/startBuilds.ts';
import { queueOutcomeFixture } from '#tests/helpers/queueOutcomeFixture.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { setupDrainLaneState } from '#tests/helpers/setupDrainLaneState.ts';

describe('startBuilds', () => {
	test('subtracts active merges and retired questions from the builder budget', async () => {
		const lane = setupDrainLaneState({ maxParallel: 3 });
		const tickets = [queueTicketFixture({ number: 1 }), queueTicketFixture({ number: 2 })];

		lane.state.pending.push(...tickets);
		lane.state.retired = 1;
		lane.flight.ships = 1;
		startBuilds(lane);

		expect(lane.runTicket.mock.calls.map(([{ ticket }]) => ticket)).toEqual([tickets[0]]);
		expect(lane.flight.builds).toBe(1);
		expect(lane.state.pending).toEqual([tickets[1]]);

		await Promise.all(lane.flight.tasks.values());

		expect(lane.flight.builds).toBe(0);
		expect(lane.state.readyToShip).toEqual([queueOutcomeFixture({ ticket: tickets[0] })]);
	});

	test.each([false, true])('records a failed build with unanswered=%s and retires only unanswered questions', async (unanswered) => {
		const lane = setupDrainLaneState();
		const ticket = queueTicketFixture();
		const outcome = queueOutcomeFixture({ ticket, ready: false, unanswered, error: 'stopped' });

		lane.state.pending.push(ticket);
		lane.runTicket.mockResolvedValue(outcome);
		startBuilds(lane);
		await Promise.all(lane.flight.tasks.values());

		expect(lane.state.outcomes).toEqual([outcome]);
		expect(lane.state.readyToShip).toEqual([]);
		expect(lane.state.retired).toBe(unanswered ? 1 : 0);
		expect(lane.flight.builds).toBe(0);
	});

	test('turns a thrown worker error into a parked result and releases its builder slot', async () => {
		const lane = setupDrainLaneState({ maxParallel: 1 });
		const ticket = queueTicketFixture();

		lane.state.pending.push(ticket);
		lane.runTicket.mockRejectedValue(new Error('worker disappeared'));
		startBuilds(lane);
		await Promise.all(lane.flight.tasks.values());

		expect(lane.state.outcomes).toEqual([expect.objectContaining({ ticket, ready: false, error: 'worker disappeared', branch: 'lo-70-ticket-70' })]);
		expect(lane.state.retired).toBe(0);
		expect(lane.flight.builds).toBe(0);
	});
});
