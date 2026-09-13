import { describe, expect, test } from '@jest/globals';
import { isParkedOutcome } from '#src/queue/common/utils/isParkedOutcome.ts';
import { queueOutcomeFixture } from '#tests/helpers/queueOutcomeFixture.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';

const setupOutcomes = () => {
	const readyOutcome = queueOutcomeFixture({ ticket: queueTicketFixture({ number: 70 }), ready: true });
	const openOutcome = queueOutcomeFixture({
		ticket: queueTicketFixture({ number: 71 }),
		ready: false,
		open: 'LO-71 has no ship request, so the ticket stays open',
	});
	const failedOutcome = queueOutcomeFixture({
		ticket: queueTicketFixture({ number: 72 }),
		ready: false,
		error: 'plan 002-search-basics failed — run `lightsout resume --run run-9`',
	});

	return { readyOutcome, openOutcome, failedOutcome };
};

describe('isParkedOutcome', () => {
	test('isParkedOutcome: only an outcome that is neither ready nor open is parked', () => {
		const { readyOutcome, openOutcome, failedOutcome } = setupOutcomes();

		const parked = [readyOutcome, openOutcome, failedOutcome].map((outcome) => isParkedOutcome({ outcome }));

		expect(parked).toStrictEqual([false, false, true]);
	});
});
