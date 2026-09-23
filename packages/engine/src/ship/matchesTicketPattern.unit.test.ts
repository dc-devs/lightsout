import { describe, expect, test } from '@jest/globals';
import { matchesTicketPattern } from '#src/ship/index.ts';

/** This repo's own pattern: a ticket group with a nested one inside it, so a forwarded match would be visible. */
const ticketPattern = /^(?<ticket>lo-(?<number>\d+))/;

describe('matchesTicketPattern', () => {
	test('answers whether a branch carries a ticket the configured pattern reads, and nothing more', () => {
		const carriesTicket = matchesTicketPattern({ branch: 'lo-60-ship-command', ticketPattern });
		const carriesNone = matchesTicketPattern({ branch: 'fix-the-thing', ticketPattern });

		expect({ carriesTicket, carriesNone }).toStrictEqual({ carriesTicket: true, carriesNone: false });
	});

	test('a pattern that matches the branch but captures no ticket answers false, because there would be no ticket reference to record', () => {
		const carriesTicket = matchesTicketPattern({
			branch: 'lo-60-ship-command',
			ticketPattern: /^(?<project>[a-z]+)/,
		});

		expect(carriesTicket).toBe(false);
	});
});
