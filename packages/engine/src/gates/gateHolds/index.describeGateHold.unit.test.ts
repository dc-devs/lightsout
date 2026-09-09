import { describe, expect, test } from '@jest/globals';
import type { GateHold } from '#src/contracts/index.ts';
import { describeGateHold } from '#src/gates/gateHolds/index.ts';

/**
 * A hold this machine has a record of. `labelConfirmed` is the one field the
 * sentence has to change on, so it is the only parameter.
 */
const setupHold = ({ labelConfirmed = true }: { labelConfirmed?: boolean } = {}) => {
	const hold: GateHold = {
		takenAt: '2026-02-14T09:30:00.000Z',
		runId: 'run-7f3a',
		worktreePath: '/repos/lightsout-worktrees/lo-119',
		reason: 'gates never started: this run waited 30m for another gate run on this machine to finish.',
		labelConfirmed,
	};

	return { hold, identifier: 'LO-119' };
};

/**
 * The second case `isTicketGateHeld` answers true for: the ticket carries the
 * blocked label, and this machine holds no record of it at all.
 */
const setupLabelOnly = () => ({ hold: undefined, identifier: 'LO-119' });

describe('describeGateHold', () => {
	test('names the label to remove, the holder and the reason', () => {
		const { hold, identifier } = setupHold();

		const sentence = describeGateHold({ hold, identifier });

		expect(sentence).toEqual(expect.stringContaining('queue-blocked-gate-timed-out'));
		expect(sentence).toEqual(expect.stringContaining('run-7f3a'));
		expect(sentence).toEqual(expect.stringContaining('/repos/lightsout-worktrees/lo-119'));
		expect(sentence).toEqual(expect.stringContaining(hold.reason));
	});

	test('says the label write never landed for an unconfirmed hold', () => {
		const { hold, identifier } = setupHold({ labelConfirmed: false });

		const sentence = describeGateHold({ hold, identifier });

		expect(sentence).toMatch(/never (landed|reached|made it|applied|written)|(did not|never did) land|was never (written|applied|recorded|added)/i);
		expect(sentence).toEqual(expect.stringContaining('queue-blocked-gate-timed-out'));
	});

	test('describes a label-only hold without inventing a holder', () => {
		const { hold, identifier } = setupLabelOnly();

		const sentence = describeGateHold({ hold, identifier });

		expect(sentence).toEqual(expect.stringContaining('queue-blocked-gate-timed-out'));
		expect(sentence).toMatch(/no (local )?record/i);
		expect(sentence).not.toMatch(/undefined|NaN|Invalid Date/);
	});
});
