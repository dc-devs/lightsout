import { describe, expect, jest, test } from '@jest/globals';
import { setTicketStatus } from '#src/ticketTracker/jira/setTicketStatus.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';

type JiraCallback = (client: { request: (params: unknown) => Promise<unknown> }) => Promise<unknown>;
const mockRunJira = jest.fn<(params: { settings: unknown; request: JiraCallback }) => Promise<unknown>>();

jest.mock('#src/ticketTracker/jira/runJira.ts', () => ({ runJira: (params: { settings: unknown; request: JiraCallback }) => mockRunJira(params) }));

describe('Jira setTicketStatus', () => {
	test('reads transitions and posts the first matching destination', async () => {
		const request = jest
			.fn<(params: unknown) => Promise<unknown>>()
			.mockResolvedValueOnce({
				transitions: [
					{ id: 'first', to: { name: 'In Progress' } },
					{ id: 'second', to: { name: 'In Progress' } },
				],
			})
			.mockResolvedValueOnce(undefined);
		mockRunJira.mockImplementation(({ request: call }) => call({ request }));

		expect(await setTicketStatus({ settings: jiraTrackerSettingsFixture(), ticketId: 'LO/1', statusName: 'In Progress' })).toBeUndefined();
		expect(request).toHaveBeenNthCalledWith(1, { method: 'GET', path: '/rest/api/3/issue/LO%2F1/transitions', response: 'json' });
		expect(request).toHaveBeenNthCalledWith(2, {
			method: 'POST',
			path: '/rest/api/3/issue/LO%2F1/transitions',
			body: { transition: { id: 'first' } },
			response: 'empty',
		});
	});

	test('names a missing destination and does not post', async () => {
		const request = jest.fn<(params: unknown) => Promise<unknown>>().mockResolvedValue({ transitions: [] });
		mockRunJira.mockImplementation(({ request: call }) => call({ request }));

		expect(await setTicketStatus({ settings: jiraTrackerSettingsFixture(), ticketId: 'LO-1', statusName: 'Done' })).toStrictEqual({
			error: "Jira ticket 'LO-1' has no 'Done' transition",
		});
		expect(request).toHaveBeenCalledTimes(1);
	});

	test('passes a tracker failure through unchanged', async () => {
		mockRunJira.mockResolvedValue({ error: 'denied' });

		expect(await setTicketStatus({ settings: jiraTrackerSettingsFixture(), ticketId: 'LO-1', statusName: 'Done' })).toStrictEqual({ error: 'denied' });
	});
});
