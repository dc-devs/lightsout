import { describe, expect, jest, test } from '@jest/globals';
import { appendTicketNote } from '#src/ticketTracker/jira/appendTicketNote.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';

type JiraCallback = (client: { request: (params: unknown) => Promise<unknown> }) => Promise<unknown>;
const mockRunJira = jest.fn<(params: { settings: unknown; request: JiraCallback }) => Promise<unknown>>();

jest.mock('#src/ticketTracker/jira/runJira.ts', () => ({ runJira: (params: { settings: unknown; request: JiraCallback }) => mockRunJira(params) }));

const existingDescription = {
	type: 'doc',
	version: 1,
	content: [
		{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Decisions' }] },
		{ type: 'paragraph', content: [{ type: 'text', text: '- first', marks: [] }] },
	],
};

describe('Jira appendTicketNote', () => {
	test('reads ADF, inserts under the shared section, and writes ADF to the literal issue path', async () => {
		const request = jest
			.fn<(params: unknown) => Promise<unknown>>()
			.mockResolvedValueOnce({ fields: { description: existingDescription } })
			.mockResolvedValueOnce(undefined);
		mockRunJira.mockImplementation(({ request: call }) => call({ request }));

		expect(await appendTicketNote({ settings: jiraTrackerSettingsFixture(), ticketId: 'LO/1', heading: '## Decisions', line: '- second' })).toBeUndefined();
		expect(request).toHaveBeenNthCalledWith(1, { method: 'GET', path: '/rest/api/3/issue/LO%2F1?fields=description', response: 'json' });
		expect(request).toHaveBeenNthCalledWith(2, {
			method: 'PUT',
			path: '/rest/api/3/issue/LO%2F1',
			body: {
				fields: {
					description: {
						type: 'doc',
						version: 1,
						content: [
							{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Decisions' }] },
							{
								type: 'paragraph',
								content: [{ type: 'text', text: '- first' }, { type: 'hardBreak' }, { type: 'text', text: '- second' }],
							},
						],
					},
				},
			},
			response: 'empty',
		});
	});

	test('initializes a missing description and keeps a repeated answer idempotent', async () => {
		const writes: unknown[] = [];
		let description: unknown = null;
		const request = jest.fn<(params: unknown) => Promise<unknown>>().mockImplementation((params) => {
			if (typeof params !== 'object' || params === null || !('method' in params)) {
				return Promise.reject(new Error('invalid request'));
			}

			if (params.method === 'PUT' && 'body' in params) {
				writes.push(params.body);
				description = (params.body as { fields: { description: unknown } }).fields.description;
			}

			return Promise.resolve(params.method === 'GET' ? { fields: { description } } : undefined);
		});
		mockRunJira.mockImplementation(({ request: call }) => call({ request }));

		await appendTicketNote({ settings: jiraTrackerSettingsFixture(), ticketId: 'LO-1', heading: '## Decisions', line: '- answer' });
		await appendTicketNote({ settings: jiraTrackerSettingsFixture(), ticketId: 'LO-1', heading: '## Decisions', line: '- answer' });

		expect(writes[0]).toStrictEqual(writes[1]);
	});

	test('rejects malformed nonempty ADF without writing and passes REST failures through', async () => {
		const request = jest.fn<(params: unknown) => Promise<unknown>>().mockResolvedValue({ fields: { description: { bad: true } } });
		mockRunJira.mockImplementationOnce(({ request: call }) => call({ request }));

		expect(await appendTicketNote({ settings: jiraTrackerSettingsFixture(), ticketId: 'LO-1', heading: '## Decisions', line: '- answer' })).toStrictEqual({
			error: "Jira ticket 'LO-1' has a malformed description",
		});
		expect(request).toHaveBeenCalledTimes(1);

		mockRunJira.mockResolvedValueOnce({ error: 'denied' });
		expect(await appendTicketNote({ settings: jiraTrackerSettingsFixture(), ticketId: 'LO-1', heading: '## Decisions', line: '- answer' })).toStrictEqual({
			error: 'denied',
		});
	});
});
