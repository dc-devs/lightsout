import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';
import type { WorkOrderRunOutcome } from '#src/queue/common/types/WorkOrderRunOutcome.ts';
import { startBuilds } from '#src/queue/drainLanes/internal/common/utils/startBuilds.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { namedWorkOrderFixture } from '#tests/helpers/namedWorkOrderFixture.ts';
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

/**
 * A lane standing in a checkout that holds one work-order record, with the
 * pending entry that record names.
 *
 * The label and the stored branch are deliberately different strings, and
 * neither is what `{ticket}-{slug}` would render for this ticket, so an outcome
 * carrying either of them can only have read the work order.
 */
const setupNamedWorkOrderLane = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-lane-work-order-'));
	const name = 'lo-70-stored-label';
	const branch = 'feature/lo-70-stored-branch';
	const folder = join(cwd, '.lightsout', 'work-orders', name);

	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, 'state.json'), JSON.stringify({ schemaVersion: 1, name, branch, mode: 'multiple-plan', plans: [], history: [] }));

	const lane = setupDrainLaneState({ maxParallel: 1 });
	const workOrder: NamedWorkOrder = { ticket: queueTicketFixture(), name, branch };

	return { ...lane, context: { ...lane.context, cwd }, workOrder, worktreesRoot: `${cwd}-worktrees` };
};

describe('startBuilds', () => {
	test('subtracts active merges and retired questions from the builder budget', async () => {
		const lane = setupDrainLaneState({ maxParallel: 3 });
		const tickets = [queueTicketFixture({ number: 1 }), queueTicketFixture({ number: 2 })];
		const workOrders = tickets.map((ticket) => namedWorkOrderFixture({ ticket }));

		lane.state.pending.push(...workOrders);
		lane.state.retired = 1;
		lane.flight.ships = 1;
		startBuilds(lane);

		expect(lane.runWorkOrder.mock.calls.map(([{ workOrder }]) => workOrder)).toEqual([workOrders[0]]);
		expect(lane.flight.builds).toBe(1);
		expect(lane.state.pending).toEqual([workOrders[1]]);

		await Promise.all(lane.flight.tasks.values());

		expect(lane.flight.builds).toBe(0);
		expect(lane.state.readyToShip).toEqual([queueOutcomeFixture({ ticket: tickets[0] })]);
	});

	test.each([false, true])('records a failed build with unanswered=%s and retires only unanswered questions', async (unanswered) => {
		const lane = setupDrainLaneState();
		const ticket = queueTicketFixture();
		const outcome = queueOutcomeFixture({ ticket, ready: false, unanswered, error: 'stopped' });

		lane.state.pending.push(namedWorkOrderFixture({ ticket }));
		lane.runWorkOrder.mockResolvedValue(outcome);
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
		const workOrder = namedWorkOrderFixture({ ticket });

		lane.state.pending.push(workOrder);
		lane.runWorkOrder.mockRejectedValue(new Error('worker disappeared'));
		startBuilds(lane);
		await Promise.all(lane.flight.tasks.values());

		expect(lane.state.outcomes).toEqual([expect.objectContaining({ ticket, ready: false, error: 'worker disappeared', branch: workOrder.branch })]);
		expect(lane.state.retired).toBe(0);
		expect(lane.flight.builds).toBe(0);
	});

	test('parks a thrown build with its primary-rooted worktree path', async () => {
		const lane = setupLinkedWorktreeLane();
		const ticket = queueTicketFixture();
		const workOrder = namedWorkOrderFixture({ ticket });

		lane.state.pending.push(workOrder);
		lane.runWorkOrder.mockRejectedValue(new Error('worker disappeared'));
		startBuilds(lane);
		await Promise.all(lane.flight.tasks.values());

		const parked = lane.state.outcomes[0];

		expectDefined(parked);

		expect({
			parent: realpathSync(dirname(dirname(parked.worktreePath))),
			root: basename(dirname(parked.worktreePath)),
			label: basename(parked.worktreePath),
			error: parked.error,
			sitsInsideTheLinkedTree: parked.worktreePath.startsWith(lane.worktree),
			builds: lane.flight.builds,
			retired: lane.state.retired,
		}).toStrictEqual({
			parent: realpathSync(dirname(lane.primary)),
			root: `${basename(lane.primary)}-worktrees`,
			label: workOrder.name,
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
		const shippedWorkOrder = namedWorkOrderFixture({ ticket: shipped });
		const crashedWorkOrder = namedWorkOrderFixture({ ticket: crashed });
		const shippedOutcome = queueOutcomeFixture({ ticket: shipped });
		const finishes = new Map<string, { resolve: (outcome: WorkOrderRunOutcome) => void; reject: (error: Error) => void }>();

		lane.state.pending.push(shippedWorkOrder, crashedWorkOrder);
		lane.runWorkOrder.mockImplementation(
			({ workOrder }) =>
				new Promise<WorkOrderRunOutcome>((resolve, reject) => {
					finishes.set(workOrder.ticket.identifier, { resolve, reject });
				}),
		);
		const earliest = Date.now();
		startBuilds(lane);
		const latest = Date.now();

		const opened = [...lane.state.building.entries()].map(([key, build]) => ({ key, workOrder: build.workOrder, startedAt: build.startedAt }));

		expect(opened).toEqual([
			{ key: 'lo-1', workOrder: shippedWorkOrder, startedAt: expect.any(String) },
			{ key: 'lo-2', workOrder: crashedWorkOrder, startedAt: expect.any(String) },
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

	test("parks a crashed build against the work order's stored branch", async () => {
		const lane = setupNamedWorkOrderLane();

		lane.state.pending.push(lane.workOrder);
		lane.runWorkOrder.mockRejectedValue(new Error('worker disappeared'));
		startBuilds(lane);
		await Promise.all(lane.flight.tasks.values());

		expect(lane.state.outcomes).toEqual([
			expect.objectContaining({
				ticket: lane.workOrder.ticket,
				branch: 'feature/lo-70-stored-branch',
				name: 'lo-70-stored-label',
				worktreePath: join(lane.worktreesRoot, 'lo-70-stored-label'),
				ready: false,
				error: 'worker disappeared',
			}),
		]);
	});
});
