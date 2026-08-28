import { describe, expect, test } from '@jest/globals';
import { readTicketMatch } from '#src/ship/readTicketMatch.ts';

/** This repo's own pattern: one group for the result file, a nested one for the body template. */
const nestedPattern = /^(?<ticket>lo-(?<number>\d+))/;

describe('readTicketMatch', () => {
	test('a matching branch answers with every group the pattern captured', () => {
		const matched = readTicketMatch({ branch: 'lo-60-ship-command', ticketPattern: nestedPattern });

		expect(matched).toStrictEqual({ ticket: 'lo-60', number: '60' });
	});

	test('a branch the pattern does not match answers undefined', () => {
		const matched = readTicketMatch({ branch: 'fix-the-thing', ticketPattern: nestedPattern });

		expect(matched).toBe(undefined);
	});

	test('a pattern that matches but names no ticket group answers undefined, because there would be no ticket reference to record', () => {
		const matched = readTicketMatch({ branch: 'lo-60-ship-command', ticketPattern: /^(?<project>[a-z]+)/ });

		expect(matched).toBe(undefined);
	});

	test('a group that did not capture is dropped, so a body template naming it stays visibly unsubstituted', () => {
		const matched = readTicketMatch({ branch: 'lo-60-ship', ticketPattern: /^(?<ticket>lo-\d+)(?<suffix>-hotfix)?/ });

		expect(matched).toStrictEqual({ ticket: 'lo-60' });
	});
});
