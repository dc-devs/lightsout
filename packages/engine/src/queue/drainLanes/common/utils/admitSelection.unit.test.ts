import { describe, expect, test } from '@jest/globals';
import { admitSelection } from '#src/queue/drainLanes/common/utils/admitSelection.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { setupDrainLaneState } from '#tests/helpers/setupDrainLaneState.ts';

describe('admitSelection', () => {
	test('admits each identifier once regardless of casing, preserving admission order', () => {
		const { state } = setupDrainLaneState();
		const first = queueTicketFixture({ number: 1 });
		const second = queueTicketFixture({ number: 2 });

		const admitted = admitSelection({ state, selection: { runnable: [first, { ...first, identifier: 'lo-1' }, second], blocked: [], skipped: [] } });

		expect(admitted).toEqual([first, second]);
		expect(state.pending).toEqual([first, second]);
		expect(state.queued).toEqual([first, second]);
		expect([...state.attempted]).toEqual(['lo-1', 'lo-2']);
	});

	test('retains blocked tickets across empty scans and removes them when admitted or settled', () => {
		const { state } = setupDrainLaneState();
		const blocked = [
			{ identifier: 'LO-1', reason: 'blocked' },
			{ identifier: 'LO-2', reason: 'blocked' },
		];

		admitSelection({ state, selection: { runnable: [], blocked, skipped: [] } });
		admitSelection({ state, selection: { runnable: [], blocked: [], skipped: [] } });

		expect([...state.blockedByIdentifier.values()]).toEqual(blocked);
		expect(state.attempted.size).toBe(0);

		const skipped = { identifier: 'lo-2', reason: 'already merged', settled: true };
		const ticket = queueTicketFixture({ number: 1 });

		admitSelection({ state, selection: { runnable: [ticket], blocked: [], skipped: [skipped] } });

		expect(state.blockedByIdentifier.size).toBe(0);
		expect(state.leftBehind).toEqual([skipped]);
		expect(state.pending).toEqual([ticket]);
		expect([...state.attempted]).toEqual(['lo-1', 'lo-2']);
	});

	test('never readmits a previously settled or attempted ticket', () => {
		const { state } = setupDrainLaneState();

		state.attempted.add('lo-1');

		expect(admitSelection({ state, selection: { runnable: [queueTicketFixture({ number: 1 })], blocked: [], skipped: [] } })).toEqual([]);
		expect(state.pending).toEqual([]);
		expect(state.queued).toEqual([]);
	});
});
