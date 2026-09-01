import { describe, expect, jest, test } from '@jest/globals';
import { appendTicketNote } from '#src/queue/tracker/jira/index.ts';
import { jiraQueueSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';

const setupHttpBoundary = () => {
	const settings = jiraQueueSettingsFixture();
	const mockFetch = jest
		.spyOn(global, 'fetch')
		.mockResolvedValueOnce(new Response(JSON.stringify({ fields: { description: null } }), { status: 200 }))
		.mockResolvedValueOnce(new Response(null, { status: 204 }));

	return { settings, mockFetch };
};

describe('appendTicketNote', () => {
	test('reads and writes the Jira issue through the authenticated HTTP boundary', async () => {
		const { settings, mockFetch } = setupHttpBoundary();

		const result = await appendTicketNote({ settings, ticketId: 'LO/70', heading: '## Decisions', line: '- choose Jira' });

		expect(result).toBeUndefined();
		expect(mockFetch).toHaveBeenNthCalledWith(1, 'https://example.atlassian.net/rest/api/3/issue/LO%2F70?fields=description', {
			method: 'GET',
			headers: { Accept: 'application/json', Authorization: expect.stringMatching(/^Basic /u) },
			body: undefined,
		});
		expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://example.atlassian.net/rest/api/3/issue/LO%2F70', {
			method: 'PUT',
			headers: {
				Accept: 'application/json',
				Authorization: expect.stringMatching(/^Basic /u),
				'Content-Type': 'application/json',
			},
			body: expect.stringMatching(/"description":\{"type":"doc","version":1,"content":.*"text":"Decisions".*"text":"choose Jira"/u),
		});
	});
});
