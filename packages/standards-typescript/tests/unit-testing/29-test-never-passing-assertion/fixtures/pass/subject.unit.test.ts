import { expect, describe, test } from '@jest/globals';

describe('subject', () => {
	test('reads back a record written without a ticket', () => {
		const record = JSON.parse('{"name":"add-search-basics"}');

		expect({ name: record.name, carriesTicketRef: Object.hasOwn(record, 'ticketRef') }).toStrictEqual({
			name: 'add-search-basics',
			carriesTicketRef: false,
		});
	});
});
