import { expect, test } from '@jest/globals';
import { readPlanTicketRef } from '#src/plan/readPlanTicketRef.ts';

/** The engine's own default, which is what a repo naming no pattern is read with. */
const defaultPattern = /^(?<ticket>[a-z]+-\d+)/;

test('readPlanTicketRef: a folder named after its branch answers the ticket id, and nothing else from the name', () => {
	expect(readPlanTicketRef({ name: 'lo-52-status-progress', ticketPattern: defaultPattern })).toBe('lo-52');
});

test('readPlanTicketRef: a bare slug carries no ticket id', () => {
	expect(readPlanTicketRef({ name: 'rate-limit-banner', ticketPattern: defaultPattern })).toBe(undefined);
});

test('readPlanTicketRef: a repo whose pattern names a different prefix reads its own spelling and no other', () => {
	const ticketPattern = /^(?<ticket>ENG-(?<number>\d+))/;

	expect(readPlanTicketRef({ name: 'ENG-7-thing', ticketPattern })).toBe('ENG-7');
	// the default spelling is not a second convention the reader also accepts
	expect(readPlanTicketRef({ name: 'lo-52-status-progress', ticketPattern })).toBe(undefined);
});

test('readPlanTicketRef: a repo whose tickets are bare numbers gets the number, not a prefixed id', () => {
	expect(readPlanTicketRef({ name: '412-rate-limit-banner', ticketPattern: /^(?<ticket>\d+)/ })).toBe('412');
});

test('readPlanTicketRef: a pattern capturing no ticket group answers undefined, matching how a branch is read', () => {
	// the whole record is dropped without a `ticket` group, so there is nothing
	// for the plan side to take
	expect(readPlanTicketRef({ name: 'lo-52-status-progress', ticketPattern: /^(?<number>\d+)?[a-z]+/ })).toBe(undefined);
});

test('readPlanTicketRef: a slug that merely looks like a ticket id is read as one, exactly as a branch would be', () => {
	// deliberately not guarded — a guard here would be a second rule about what
	// a ticket id looks like, which is the drift this reader exists to prevent
	expect(readPlanTicketRef({ name: 'phase-2-cleanup', ticketPattern: defaultPattern })).toBe('phase-2');
});
