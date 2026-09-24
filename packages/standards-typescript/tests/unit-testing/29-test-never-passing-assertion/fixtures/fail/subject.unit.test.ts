import { expect, describe, test } from '@jest/globals';

describe('subject', () => {
	test('reads back a record written without a ticket', () => {
		const record = JSON.parse('{"name":"add-search-basics"}');

		expect(record).toEqual(expect.objectContaining({ name: 'add-search-basics', ticketRef: undefined }));
	});
});
