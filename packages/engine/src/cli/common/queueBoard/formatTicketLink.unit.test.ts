import { describe, expect, test } from '@jest/globals';
import { formatTicketLink } from '#src/cli/common/queueBoard/formatTicketLink.ts';

type LinkTicket = Parameters<typeof formatTicketLink>[0]['ticket'];

/** A board ticket's label fields: an identifier, with a title and a link unless a case leaves them out. */
const setupTicket = (overrides: Partial<LinkTicket> = {}): LinkTicket => ({
	identifier: 'EX-101',
	title: 'Notifications',
	url: 'https://tracker.example.com/EX-101',
	...overrides,
});

describe('formatTicketLink', () => {
	test("links the identifier and title to the ticket's url", () => {
		const ticket = setupTicket();

		const label = formatTicketLink({ ticket });

		expect(label).toBe('[EX-101 · Notifications](https://tracker.example.com/EX-101)');
	});

	test('shows the label unlinked, and the identifier alone, when the board recorded no url or title', () => {
		const tickets = [setupTicket({ url: undefined }), setupTicket({ title: undefined, url: undefined })];

		const labels = tickets.map((ticket) => formatTicketLink({ ticket }));

		expect(labels).toStrictEqual(['EX-101 · Notifications', 'EX-101']);
	});

	test('escapes a bracket in the title so it cannot close the link text early', () => {
		const ticket = setupTicket({ title: 'Handle ] in names' });

		const label = formatTicketLink({ ticket });

		expect(label).toBe('[EX-101 · Handle \\] in names](https://tracker.example.com/EX-101)');
	});
});
