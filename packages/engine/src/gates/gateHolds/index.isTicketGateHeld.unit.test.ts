import { describe, expect, test } from '@jest/globals';
import { type GateHolds, isTicketGateHeld } from '#src/gates/gateHolds/index.ts';

const setupHolds = (): { holds: GateHolds } => {
	const holds: GateHolds = {
		'lo-119': {
			takenAt: '2026-09-08T10:00:00.000Z',
			runId: 'run-1',
			worktreePath: '/repo/.worktrees/lo-119',
			reason: 'The gates never got the machine within the wait ceiling.',
			labelConfirmed: true,
		},
	};

	return { holds };
};

describe('isTicketGateHeld', () => {
	test('matches a held ticket whatever case the identifier is written in', () => {
		const { holds } = setupHolds();

		const upperCased = isTicketGateHeld({ holds, identifier: 'LO-119', labels: [] });
		const lowerCased = isTicketGateHeld({ holds, identifier: 'lo-119', labels: [] });
		const absent = isTicketGateHeld({ holds, identifier: 'LO-404', labels: [] });

		expect({ upperCased, lowerCased, absent }).toEqual({
			upperCased: true,
			lowerCased: true,
			absent: false,
		});
	});

	test('refuses a ticket carrying the blocked label with no local record', () => {
		const { holds } = setupHolds();

		const labelled = isTicketGateHeld({ holds, identifier: 'LO-404', labels: ['queue-parked', 'queue-blocked-gate-timed-out'] });
		const parkedOnly = isTicketGateHeld({ holds, identifier: 'LO-404', labels: ['queue-parked'] });

		// the label is what still blocks when this machine's record was lost — a
		// failed local write, or somebody clearing `.lightsout` in the primary
		// checkout — and it is what makes "remove the label to release" literally true
		expect({ labelled, parkedOnly }).toEqual({ labelled: true, parkedOnly: false });
	});
});
