import { execSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { startBuilds } from '#src/queue/drainLanes/common/utils/startBuilds.ts';
import type { TicketRunOutcome } from '#src/queue/index.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { queueOutcomeFixture } from '#tests/helpers/queueOutcomeFixture.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { setupDrainLaneState } from '#tests/helpers/setupDrainLaneState.ts';

/**
 * A lane standing in a linked worktree of a real repository — the shape a drain
 * takes when it is launched from a worktree rather than the primary checkout.
 */
const setupLinkedWorktreeLane = () => {
	const { cwd: primary } = setupBranchRepo();
	const worktree = join(primary, '.worktrees', 'lo-131-lane-worktree');

	execSync(`git worktree add -q -b lo-131-lane-worktree "${worktree}" main`, { cwd: primary, stdio: 'ignore' });

	const lane = setupDrainLaneState({ maxParallel: 1 });

	return { ...lane, context: { ...lane.context, cwd: worktree }, primary, worktree };
};

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

	test('parks a thrown build with its primary-rooted worktree path', async () => {
		const lane = setupLinkedWorktreeLane();
		const ticket = queueTicketFixture();

		lane.state.pending.push(ticket);
		lane.runTicket.mockRejectedValue(new Error('worker disappeared'));
		startBuilds(lane);
		await Promise.all(lane.flight.tasks.values());

		const parked = lane.state.outcomes[0];

		expectDefined(parked);

		expect({
			parent: realpathSync(dirname(dirname(parked.worktreePath))),
			root: basename(dirname(parked.worktreePath)),
			branch: basename(parked.worktreePath),
			error: parked.error,
			sitsInsideTheLinkedTree: parked.worktreePath.startsWith(lane.worktree),
			builds: lane.flight.builds,
			retired: lane.state.retired,
		}).toStrictEqual({
			parent: realpathSync(dirname(lane.primary)),
			root: `${basename(lane.primary)}-worktrees`,
			branch: 'lo-70-ticket-70',
			error: 'worker disappeared',
			sitsInsideTheLinkedTree: false,
			builds: 0,
			retired: 0,
		});
	});

	test('holds a started build in the building ledger until its outcome is settled', async () => {
		const lane = setupDrainLaneState({ maxParallel: 2 });
		const shipped = queueTicketFixture({ number: 1 });
		const crashed = queueTicketFixture({ number: 2 });
		const shippedOutcome = queueOutcomeFixture({ ticket: shipped });
		const finishes = new Map<string, { resolve: (outcome: TicketRunOutcome) => void; reject: (error: Error) => void }>();

		lane.state.pending.push(shipped, crashed);
		lane.runTicket.mockImplementation(
			({ ticket }) =>
				new Promise<TicketRunOutcome>((resolve, reject) => {
					finishes.set(ticket.identifier, { resolve, reject });
				}),
		);
		const earliest = Date.now();
		startBuilds(lane);
		const latest = Date.now();

		const opened = [...lane.state.building.entries()].map(([key, build]) => ({ key, ticket: build.ticket, startedAt: build.startedAt }));

		expect(opened).toEqual([
			{ key: 'lo-1', ticket: shipped, startedAt: expect.any(String) },
			{ key: 'lo-2', ticket: crashed, startedAt: expect.any(String) },
		]);
		expect(
			opened.map(({ startedAt }) => ({
				iso: new Date(startedAt).toISOString() === startedAt,
				duringTheCall: Date.parse(startedAt) >= earliest && Date.parse(startedAt) <= latest,
			})),
		).toStrictEqual([
			{ iso: true, duringTheCall: true },
			{ iso: true, duringTheCall: true },
		]);

		const shippedFinish = finishes.get('LO-1');
		const shippedTask = lane.flight.tasks.get(0);

		expectDefined(shippedFinish);
		expectDefined(shippedTask);
		shippedFinish.resolve(shippedOutcome);
		await shippedTask;

		expect([...lane.state.building.keys()]).toEqual(['lo-2']);
		expect(lane.state.readyToShip).toEqual([shippedOutcome]);

		const crashedFinish = finishes.get('LO-2');

		expectDefined(crashedFinish);
		crashedFinish.reject(new Error('worker disappeared'));
		await Promise.all(lane.flight.tasks.values());

		expect([...lane.state.building.keys()]).toEqual([]);
		expect(lane.state.readyToShip).toEqual([shippedOutcome]);
		expect(lane.state.outcomes).toEqual([expect.objectContaining({ ticket: crashed, ready: false, error: 'worker disappeared' })]);
	});
});
