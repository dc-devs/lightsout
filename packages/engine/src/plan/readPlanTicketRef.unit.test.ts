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

test('readPlanTicketRef: a plan address answers the ticket id its ticket-branch segment carries', () => {
	// the id ends this repo's branch names, so matching the whole address would
	// answer undefined — the ticket is read off the ticket-branch segment alone
	const ticketPattern = /(?<ticket>\d+)$/;

	expect(readPlanTicketRef({ name: 'fix-login-123/001-search', ticketPattern })).toBe('123');
});

test('readPlanTicketRef: a plan id that reads like a ticket id is never taken for the plan address ticket', () => {
	// only the ticket-branch segment is matched, so an unanchored pattern cannot
	// reach into the plan id and invent a ticket the ticket folder does not carry
	const ticketPattern = /(?<ticket>[a-z]+-\d+)/;

	expect(readPlanTicketRef({ name: 'search-basics/001-lo-52-thing', ticketPattern })).toBe(undefined);
});

test('readPlanTicketRef: a multi-segment name that is not a plan address is still matched whole', () => {
	// `notes-99` is no plan id, so the whole name is its own ticket folder and reads
	// exactly as it did before addresses existed
	const ticketPattern = /(?<ticket>\d+)$/;

	expect(readPlanTicketRef({ name: 'lo-7-search/notes-99', ticketPattern })).toBe('99');
});
