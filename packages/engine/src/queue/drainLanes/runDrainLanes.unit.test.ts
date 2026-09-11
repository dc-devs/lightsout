import { readFileSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { WaveSelection } from '#src/queue/common/types/WaveSelection.ts';
import { createMainCheckoutSerializer } from '#src/queue/common/utils/createMainCheckoutSerializer.ts';
import { runDrainLanes } from '#src/queue/drainLanes/index.ts';
import { drainLaneOutcomeFixture as outcomeOf } from '#tests/helpers/drainLaneOutcomeFixture.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { setupDrainLanes } from '#tests/helpers/setupDrainLanes.ts';

/** Runs a task with no other main-checkout git mutation in flight. */
type SerializeMainCheckout = <Result>(params: { task: () => Promise<Result> }) => Promise<Result>;
type ShipParams = { outcome: TicketRunOutcome; serializeMainCheckout: SerializeMainCheckout };
type ScanParams = { attempted: Set<string> };
type ReconcileParams = { tickets: RunnableTicket[] };

// Mocked Imports
// -------------------------
const mockShipOneBranch = jest.fn<(params: ShipParams) => Promise<TicketRunOutcome>>();

jest.mock('#src/queue/shipOneBranch.ts', () => ({ shipOneBranch: (params: ShipParams) => mockShipOneBranch(params) }));
// -------------------------
const mockListNextWave = jest.fn<(params: ScanParams) => Promise<WaveSelection | QueueFailure>>();

jest.mock('#src/queue/ticketSelection/listNextWave.ts', () => ({ listNextWave: (params: ScanParams) => mockListNextWave(params) }));
// -------------------------
const mockReconcileMergedTickets = jest.fn<(params: ReconcileParams) => Promise<{ kept: RunnableTicket[]; leftBehind: LeftBehindTicket[] }>>();

jest.mock('#src/queue/ticketSelection/reconcileMergedTickets.ts', () => ({
	reconcileMergedTickets: (params: ReconcileParams) => mockReconcileMergedTickets(params),
}));
// -------------------------

const setupLanes = (options: Omit<Parameters<typeof setupDrainLanes>[0], 'mocks' | 'serializeMainCheckout'> = {}) => {
	const lanes = setupDrainLanes({
		...options,
		serializeMainCheckout: createMainCheckoutSerializer(),
		mocks: { ship: mockShipOneBranch, scan: mockListNextWave, reconcile: mockReconcileMergedTickets },
	});

	return { ...lanes, drain: () => lanes.trackDrain(runDrainLanes(lanes.params)) };
};

/** One entry per ticket, sorted so the assertion does not depend on the order the two lanes happened to settle in. */
const finalStatesOf = ({ outcomes }: { outcomes: TicketRunOutcome[] }) =>
	outcomes
		.map((outcome) => ({ identifier: outcome.ticket.identifier, ready: outcome.ready, error: outcome.error }))
		.sort((one, other) => one.identifier.localeCompare(other.identifier));

describe('runDrainLanes', () => {
	test('merges a branch the moment it is ready, while the other builders are still building', async () => {
		const lanes = setupLanes({ runnable: ['LO-1', 'LO-2'] });
		const drained = lanes.drain();

		await lanes.settle();
		await lanes.finishBuild({ identifier: 'LO-1' });

		const whileTheFirstMerges = { merging: lanes.merges.started(), stillBuilding: lanes.builds.running() };

		await lanes.finishEverything();
		await drained;

		expect(whileTheFirstMerges).toStrictEqual({ merging: ['LO-1'], stillBuilding: ['LO-2'] });
	});

	test('keeps the builders and the merge inside one configured budget, so no drain runs more gates at once than it does today', async () => {
		const lanes = setupLanes({ runnable: ['LO-1', 'LO-2', 'LO-3', 'LO-4'], maxParallel: 2 });
		const drained = lanes.drain();

		await lanes.settle();
		await lanes.finishEverything();

		const report = await drained;
		const budget = { peak: lanes.peakInFlight(), merged: lanes.merges.started().length, outcomes: report.outcomes.length };

		expect(budget).toStrictEqual({ peak: 2, merged: 4, outcomes: 4 });
	});

	test('gives a freed slot to a waiting ready branch before it starts another build', async () => {
		const lanes = setupLanes({ runnable: ['LO-1', 'LO-2'], maxParallel: 1 });
		const drained = lanes.drain();

		await lanes.settle();
		await lanes.finishBuild({ identifier: 'LO-1' });

		const whenTheSlotFreed = { merging: lanes.merges.started(), building: lanes.builds.started() };

		await lanes.finishEverything();
		await drained;

		expect(whenTheSlotFreed).toStrictEqual({ merging: ['LO-1'], building: ['LO-1'] });
	});

	test('merges one branch at a time, in the order the branches became ready', async () => {
		const lanes = setupLanes({ runnable: ['LO-1', 'LO-2', 'LO-3'], maxParallel: 3 });
		const drained = lanes.drain();

		await lanes.settle();
		await lanes.finishBuild({ identifier: 'LO-3' });
		await lanes.finishBuild({ identifier: 'LO-1' });
		await lanes.finishBuild({ identifier: 'LO-2' });
		await lanes.finishMerge({ identifier: 'LO-3' });
		await lanes.finishMerge({ identifier: 'LO-1' });
		await lanes.finishMerge({ identifier: 'LO-2' });
		await drained;

		expect({ merged: lanes.merges.started(), atOnce: lanes.merges.peak() }).toStrictEqual({ merged: ['LO-3', 'LO-1', 'LO-2'], atOnce: 1 });
	});

	test('admits a ticket the merge just unblocked into the run already in flight', async () => {
		const lanes = setupLanes({ runnable: ['LO-1'], blocked: [{ identifier: 'LO-2', reason: 'blocked by LO-1' }] });

		mockListNextWave.mockResolvedValueOnce({
			runnable: [queueTicketFixture({ identifier: 'LO-2', id: 'id-LO-2', title: 'Ticket LO-2' })],
			blocked: [],
			skipped: [],
		});

		const drained = lanes.drain();

		await lanes.settle();
		await lanes.finishBuild({ identifier: 'LO-1' });
		await lanes.finishMerge({ identifier: 'LO-1' });
		await lanes.builds.untilStarted({ identifier: 'LO-2' });
		await lanes.finishEverything();

		const report = await drained;
		const admitted = { built: lanes.builds.started(), scans: mockListNextWave.mock.calls.length, states: finalStatesOf({ outcomes: report.outcomes }) };

		expect(admitted).toStrictEqual({
			built: ['LO-1', 'LO-2'],
			scans: 1,
			states: [
				{ identifier: 'LO-1', ready: true, error: undefined },
				{ identifier: 'LO-2', ready: true, error: undefined },
			],
		});
	});

	test('carries on building and merging after one branch fails to merge, and reports that ticket parked', async () => {
		const lanes = setupLanes({ runnable: ['LO-1', 'LO-2'] });
		const drained = lanes.drain();

		await lanes.settle();
		await lanes.finishBuild({ identifier: 'LO-1' });
		await lanes.finishBuild({ identifier: 'LO-2' });
		await lanes.finishMerge({ identifier: 'LO-1', end: 'failed', error: 'the branch would not rebase onto origin/main' });
		await lanes.finishMerge({ identifier: 'LO-2' });

		const report = await drained;

		expect({ merged: lanes.merges.started(), states: finalStatesOf({ outcomes: report.outcomes }) }).toStrictEqual({
			merged: ['LO-1', 'LO-2'],
			states: [
				{ identifier: 'LO-1', ready: false, error: 'the branch would not rebase onto origin/main' },
				{ identifier: 'LO-2', ready: true, error: undefined },
			],
		});
	});

	test('reports one entry per ticket, merged ones ready and parked ones carrying their reason', async () => {
		const lanes = setupLanes({ runnable: ['LO-1', 'LO-2', 'LO-3'], maxParallel: 3 });
		const drained = lanes.drain();

		await lanes.settle();
		await lanes.finishBuild({ identifier: 'LO-1' });
		await lanes.finishBuild({ identifier: 'LO-2', end: 'failed', error: 'the gates went red' });
		await lanes.finishBuild({ identifier: 'LO-3' });
		await lanes.finishMerge({ identifier: 'LO-1' });
		await lanes.finishMerge({ identifier: 'LO-3', end: 'failed', error: 'the merge was blocked' });

		const report = await drained;

		expect({ states: finalStatesOf({ outcomes: report.outcomes }), leftBehind: report.leftBehind }).toStrictEqual({
			states: [
				{ identifier: 'LO-1', ready: true, error: undefined },
				{ identifier: 'LO-2', ready: false, error: 'the gates went red' },
				{ identifier: 'LO-3', ready: false, error: 'the merge was blocked' },
			],
			leftBehind: [],
		});
	});

	test('retires the slot an unanswered question held and still merges the branches already waiting', async () => {
		const lanes = setupLanes({ runnable: ['LO-1', 'LO-2', 'LO-3', 'LO-4'], maxParallel: 2 });
		const drained = lanes.drain();

		await lanes.settle();
		await lanes.finishBuild({ identifier: 'LO-1', end: 'unanswered' });
		await lanes.finishBuild({ identifier: 'LO-2' });
		await lanes.finishMerge({ identifier: 'LO-2' });
		await lanes.finishBuild({ identifier: 'LO-3', end: 'unanswered' });

		const report = await drained;

		expect({ built: lanes.builds.started(), merged: lanes.merges.started(), leftBehind: report.leftBehind }).toEqual({
			built: ['LO-1', 'LO-2', 'LO-3'],
			merged: ['LO-2'],
			leftBehind: [
				{
					identifier: 'LO-4',
					title: 'Ticket LO-4',
					url: 'https://linear.app/lightsout/issue/LO-70',
					reason: expect.stringContaining('every slot was retired'),
				},
			],
		});
	});

	test('names every ticket it never started, so nothing vanishes from the summary', async () => {
		const lanes = setupLanes({ runnable: ['LO-1', 'LO-2'], maxParallel: 1 });
		const drained = lanes.drain();

		await lanes.settle();
		await lanes.finishBuild({ identifier: 'LO-1', end: 'unanswered' });

		const report = await drained;

		expect({ leftBehind: report.leftBehind, progress: lanes.progress }).toEqual({
			leftBehind: [
				{
					identifier: 'LO-2',
					title: 'Ticket LO-2',
					url: 'https://linear.app/lightsout/issue/LO-70',
					reason: 'not started: every slot was retired by a ticket parked on an unanswered question',
				},
			],
			progress: expect.arrayContaining([expect.stringContaining('LO-2 · not started: every slot was retired')]),
		});
	});

	test('names a never-started ticket with its title and link beside the unchanged not-started reason', async () => {
		const blockedEntry = { identifier: 'LO-9', reason: 'blocked by LO-8' };
		const lanes = setupLanes({ runnable: ['LO-1', 'LO-2', 'LO-3'], blocked: [blockedEntry], maxParallel: 1 });
		const runnable = lanes.params.first.runnable.map((ticket) => ({ ...ticket, url: `https://linear.app/lightsout/issue/${ticket.identifier}` }));
		const drained = runDrainLanes({ ...lanes.params, first: { ...lanes.params.first, runnable } });

		await lanes.settle();
		await lanes.finishBuild({ identifier: 'LO-1', end: 'unanswered' });

		const report = await drained;

		expect(report.leftBehind).toStrictEqual([
			{
				identifier: 'LO-2',
				title: 'Ticket LO-2',
				url: 'https://linear.app/lightsout/issue/LO-2',
				reason: 'not started: every slot was retired by a ticket parked on an unanswered question',
			},
			{
				identifier: 'LO-3',
				title: 'Ticket LO-3',
				url: 'https://linear.app/lightsout/issue/LO-3',
				reason: 'not started: every slot was retired by a ticket parked on an unanswered question',
			},
			{ identifier: 'LO-9', reason: 'blocked by LO-8' },
		]);
	});

	test("records a ticket admitted mid-run in the coordinator's queue document", async () => {
		const lanes = setupLanes({ runnable: ['LO-1'], blocked: [{ identifier: 'LO-2', reason: 'blocked by LO-1' }] });

		mockListNextWave.mockResolvedValueOnce({
			runnable: [queueTicketFixture({ identifier: 'LO-2', id: 'id-LO-2', title: 'Ticket LO-2' })],
			blocked: [],
			skipped: [],
		});

		const drained = lanes.drain();

		await lanes.settle();
		await lanes.finishBuild({ identifier: 'LO-1' });
		await lanes.finishMerge({ identifier: 'LO-1' });
		await lanes.builds.untilStarted({ identifier: 'LO-2' });
		await lanes.finishEverything();
		await drained;

		const plan = readFileSync(lanes.planPath, 'utf8');

		expect(plan).toEqual(expect.stringContaining('LO-2 · direct ·'));
	});

	test('finishes the branches it already holds when a re-scan fails, rather than throwing the drain away', async () => {
		const blockedEntry = { identifier: 'LO-2', reason: 'blocked by LO-9' };
		const lanes = setupLanes({ runnable: ['LO-1'], blocked: [blockedEntry] });

		mockListNextWave.mockResolvedValueOnce({ error: 'the tracker did not answer' });

		const drained = lanes.drain();

		await lanes.settle();
		await lanes.finishBuild({ identifier: 'LO-1' });
		await lanes.finishMerge({ identifier: 'LO-1' });

		const report = await drained;

		expect({ states: finalStatesOf({ outcomes: report.outcomes }), leftBehind: report.leftBehind, progress: lanes.progress }).toEqual({
			states: [{ identifier: 'LO-1', ready: true, error: undefined }],
			leftBehind: [blockedEntry],
			progress: expect.arrayContaining([expect.stringContaining('the re-scan for newly unblocked tickets failed')]),
		});
	});

	test('waits for the last branch to merge before it answers, not for the last builder', async () => {
		const lanes = setupLanes({ runnable: ['LO-1'] });
		let answered = false;
		const drained = lanes.drain().then((report) => {
			answered = true;

			return report;
		});

		await lanes.settle();
		await lanes.finishBuild({ identifier: 'LO-1' });

		const whileTheLastBranchMerges = { answered, merging: lanes.merges.running() };

		await lanes.finishMerge({ identifier: 'LO-1' });
		await drained;

		expect({ whileTheLastBranchMerges, answeredAfterTheMerge: answered }).toStrictEqual({
			whileTheLastBranchMerges: { answered: false, merging: ['LO-1'] },
			answeredAfterTheMerge: true,
		});
	});

	test("keeps a merge's worktree removal and a builder's worktree creation off each other in the main checkout", async () => {
		const lanes = setupLanes({ runnable: ['LO-1', 'LO-2', 'LO-3'], maxParallel: 2 });
		const drained = lanes.drain();

		await lanes.settle();
		await lanes.finishBuild({ identifier: 'LO-1' });
		// Released together and settled once, so the merge tail's removal and the
		// next builder's creation reach the main checkout in the same turn.
		lanes.merges.release({ identifier: 'LO-1', outcome: outcomeOf({ identifier: 'LO-1' }) });
		lanes.builds.release({ identifier: 'LO-2', outcome: outcomeOf({ identifier: 'LO-2' }) });

		await lanes.settle();
		await lanes.finishEverything();
		await drained;

		const chain = mockShipOneBranch.mock.calls.every((call) => call[0].serializeMainCheckout === lanes.serializeMainCheckout);

		expect({ atOnce: lanes.checkout.peak(), mutations: lanes.checkout.mutations(), handedTheSameChain: chain }).toEqual({
			atOnce: 1,
			mutations: expect.arrayContaining(['remove LO-1', 'add LO-3']),
			handedTheSameChain: true,
		});
	});
});
