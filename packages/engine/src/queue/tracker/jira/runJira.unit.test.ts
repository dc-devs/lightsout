import { describe, expect, jest, test } from '@jest/globals';
import { runJira } from '#src/queue/tracker/jira/runJira.ts';
import { jiraQueueSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';

const setup = () => ({ mockFetch: jest.spyOn(global, 'fetch') });

describe('runJira', () => {
	test('builds an authenticated Cloud URL, serializes JSON, and parses a JSON response', async () => {
		const { mockFetch } = setup();
		mockFetch.mockResolvedValue(new Response(JSON.stringify({ issues: ['LO-1'] }), { status: 200 }));

		const result = await runJira({
			settings: jiraQueueSettingsFixture(),
			request: (client) =>
				client.request<{ issues: string[] }>({ method: 'POST', path: '/rest/api/3/search/jql', body: { jql: 'project = "LO"' }, response: 'json' }),
		});

		expect(result).toStrictEqual({ issues: ['LO-1'] });
		expect(mockFetch).toHaveBeenCalledWith('https://example.atlassian.net/rest/api/3/search/jql', {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				Authorization: `Basic ${Buffer.from('person@example.com:jira-token').toString('base64')}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ jql: 'project = "LO"' }),
		});
	});

	test('accepts a 204 empty response for writes', async () => {
		const { mockFetch } = setup();
		mockFetch.mockResolvedValue(new Response(null, { status: 204 }));

		const result = await runJira({
			settings: jiraQueueSettingsFixture(),
			request: (client) => client.request({ method: 'PUT', path: '/rest/api/3/issue/LO-1', response: 'empty' }),
		});

		expect(result).toBeUndefined();
	});

	test.each([
		{ response: new Response('denied', { status: 401 }), error: 'Jira request failed with 401: denied' },
		{ response: new Response('', { status: 200 }), error: 'Jira returned an empty JSON response' },
		{ response: new Response('{bad', { status: 200 }), error: 'Jira returned malformed JSON' },
	])('converts an invalid Jira response into a queue failure', async ({ response, error }) => {
		const { mockFetch } = setup();
		mockFetch.mockResolvedValue(response);

		const result = await runJira({
			settings: jiraQueueSettingsFixture(),
			request: (client) => client.request({ method: 'GET', path: '/rest/api/3/issue/LO-1', response: 'json' }),
		});

		expect(result).toStrictEqual({ error });
	});

	test('converts rejected fetches and thrown callback values into failures', async () => {
		const { mockFetch } = setup();
		mockFetch.mockRejectedValueOnce(new Error('network down'));

		expect(
			await runJira({ settings: jiraQueueSettingsFixture(), request: (client) => client.request({ method: 'GET', path: '/x', response: 'json' }) }),
		).toStrictEqual({ error: 'network down' });
		expect(await runJira({ settings: jiraQueueSettingsFixture(), request: () => Promise.reject('bad callback') })).toStrictEqual({
			error: 'bad callback',
		});
	});

	test('converts the 60 second deadline into a failure', async () => {
		jest.useFakeTimers();
		const pending = runJira({ settings: jiraQueueSettingsFixture(), request: () => new Promise(() => undefined) });

		jest.advanceTimersByTime(60_000);

		expect(await pending).toStrictEqual({ error: 'the tracker did not answer within 60000ms' });
		jest.useRealTimers();
	});
});
