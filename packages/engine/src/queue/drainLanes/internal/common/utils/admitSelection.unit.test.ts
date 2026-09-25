import { describe, expect, test } from '@jest/globals';
import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';
import type { LaneState } from '#src/queue/drainLanes/internal/common/types/LaneState.ts';
import { admitSelection } from '#src/queue/drainLanes/internal/common/utils/admitSelection.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';

/** An idle ledger, built here rather than shared, so a lane test states the only field it varies. */
const setupLedger = ({ attempted = [] }: { attempted?: string[] } = {}): { state: LaneState } => ({
	state: {
		pending: [],
		queued: [],
		building: new Map(),
		readyToShip: [],
		shipping: undefined,
		outcomes: [],
		leftBehind: [],
		attempted: new Set(attempted),
		blockedByIdentifier: new Map(),
		retired: 0,
		rescanRequested: false,
		idleScanSpent: false,
		scansStopped: false,
	},
});

/** One wave entry after its name is settled: the label and the branch the record stores. */
const namedWorkOrderFixture = ({ number, name = `lo-${number}-alpha`, branch = name }: { number: number; name?: string; branch?: string }): NamedWorkOrder => ({
	ticket: queueTicketFixture({ number }),
	name,
	branch,
});

describe('admitSelection', () => {
	test('admits each identifier once regardless of casing, preserving admission order', () => {
		const { state } = setupLedger();
		const first = namedWorkOrderFixture({ number: 1 });
		const second = namedWorkOrderFixture({ number: 2 });
		const lowerCased = { ...first, ticket: { ...first.ticket, identifier: 'lo-1' } };

		const admitted = admitSelection({ state, workOrders: [first, lowerCased, second], blocked: [], skipped: [] });

		expect(admitted).toEqual([first, second]);
		expect(state.pending).toEqual([first, second]);
		expect(state.queued).toEqual([first, second]);
		expect([...state.attempted]).toEqual(['lo-1', 'lo-2']);
	});

	test('retains blocked tickets across empty scans and removes them when admitted or settled', () => {
		const { state } = setupLedger();
		const blocked = [
			{ identifier: 'LO-1', reason: 'blocked' },
			{ identifier: 'LO-2', reason: 'blocked' },
		];

		admitSelection({ state, workOrders: [], blocked, skipped: [] });
		admitSelection({ state, workOrders: [], blocked: [], skipped: [] });

		expect([...state.blockedByIdentifier.values()]).toEqual(blocked);
		expect(state.attempted.size).toBe(0);

		const skipped = { identifier: 'lo-2', reason: 'already merged', settled: true };
		const workOrder = namedWorkOrderFixture({ number: 1 });

		admitSelection({ state, workOrders: [workOrder], blocked: [], skipped: [skipped] });

		expect(state.blockedByIdentifier.size).toBe(0);
		expect(state.leftBehind).toEqual([skipped]);
		expect(state.pending).toEqual([workOrder]);
		expect([...state.attempted]).toEqual(['lo-1', 'lo-2']);
	});

	test('never readmits a previously settled or attempted ticket', () => {
		const { state } = setupLedger({ attempted: ['lo-1'] });

		const admitted = admitSelection({ state, workOrders: [namedWorkOrderFixture({ number: 1 })], blocked: [], skipped: [] });

		expect(admitted).toEqual([]);
		expect(state.pending).toEqual([]);
		expect(state.queued).toEqual([]);
	});

	test('admits each named work order once, in admission order', () => {
		const { state } = setupLedger({ attempted: ['lo-1'] });
		const alreadyOffered = namedWorkOrderFixture({ number: 1 });
		const second = namedWorkOrderFixture({ number: 2, name: 'lo-2-beta', branch: 'feature/lo-2-beta' });
		const third = namedWorkOrderFixture({ number: 3 });

		const admitted = admitSelection({ state, workOrders: [alreadyOffered, second, third], blocked: [], skipped: [] });

		expect(admitted).toEqual([second, third]);
		expect(state.pending).toEqual([second, third]);
		expect(state.queued).toEqual([second, third]);
		expect([...state.attempted]).toEqual(['lo-1', 'lo-2', 'lo-3']);
	});
});
