import { describe, expect, test } from '@jest/globals';
import { GateHold } from '#src/contracts/index.ts';

/** The five fields one held ticket's file in `.lightsout/gate-holds/` carries. */
const setupGateHold = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const hold: Record<string, unknown> = {
		takenAt: '2026-01-01T00:00:00.000Z',
		runId: 'run-1',
		worktreePath: '/repo/worktrees/lo-119',
		reason: 'the gates never got the machine within 30 minutes',
		labelConfirmed: false,
		...extra,
	};

	if (omit) {
		delete hold[omit];
	}

	return { hold };
};

describe('GateHold', () => {
	test('requires labelConfirmed rather than defaulting it', () => {
		const { hold: complete } = setupGateHold({ extra: { labelConfirmed: true } });
		const { hold: withoutConfirmation } = setupGateHold({ omit: 'labelConfirmed' });

		const parsed = GateHold.parse(complete);
		const parsedWithoutConfirmation = GateHold.safeParse(withoutConfirmation);

		expect(parsed).toStrictEqual({
			takenAt: '2026-01-01T00:00:00.000Z',
			runId: 'run-1',
			worktreePath: '/repo/worktrees/lo-119',
			reason: 'the gates never got the machine within 30 minutes',
			labelConfirmed: true,
		});
		// an omitted flag must never read as a landed tracker write: a hold whose
		// label was never applied has to keep blocking, however the tracker looks
		expect(parsedWithoutConfirmation.success).toBe(false);
	});
});
