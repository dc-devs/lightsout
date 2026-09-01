import { describe, expect, jest, test } from '@jest/globals';
import { setParkedLabel } from '#src/queue/tracker/jira/setParkedLabel.ts';
import { jiraQueueSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';

type JiraCallback = (client: { request: (params: unknown) => Promise<unknown> }) => Promise<unknown>;
const mockRunJira = jest.fn<(params: { settings: unknown; request: JiraCallback }) => Promise<unknown>>();

jest.mock('#src/queue/tracker/jira/runJira.ts', () => ({ runJira: (params: { settings: unknown; request: JiraCallback }) => mockRunJira(params) }));

describe('Jira setParkedLabel', () => {
	test('does nothing when no parked label is configured', async () => {
		mockRunJira.mockClear();

		expect(await setParkedLabel({ settings: jiraQueueSettingsFixture(), ticketId: 'LO-1', parked: true })).toBeUndefined();
		expect(mockRunJira).not.toHaveBeenCalled();
	});

	test.each([
		{ parked: true, labels: null, operation: { add: 'queue-parked' } },
		{ parked: false, labels: ['queue-parked'], operation: { remove: 'queue-parked' } },
	])('reads labels and writes the requested add or remove update', async ({ parked, labels, operation }) => {
		const request = jest.fn<(params: unknown) => Promise<unknown>>().mockResolvedValueOnce({ fields: { labels } }).mockResolvedValueOnce(undefined);
		mockRunJira.mockImplementation(({ request: call }) => call({ request }));

		expect(await setParkedLabel({ settings: jiraQueueSettingsFixture({ parkedLabel: 'queue-parked' }), ticketId: 'LO/1', parked })).toBeUndefined();
		expect(request).toHaveBeenNthCalledWith(1, { method: 'GET', path: '/rest/api/3/issue/LO%2F1?fields=labels', response: 'json' });
		expect(request).toHaveBeenNthCalledWith(2, {
			method: 'PUT',
			path: '/rest/api/3/issue/LO%2F1',
			body: { update: { labels: [operation] } },
			response: 'empty',
		});
	});

	test.each([
		{ parked: true, labels: ['queue-parked'] },
		{ parked: false, labels: [] },
	])('avoids a duplicate or ineffective update', async ({ parked, labels }) => {
		const request = jest.fn<(params: unknown) => Promise<unknown>>().mockResolvedValue({ fields: { labels } });
		mockRunJira.mockImplementation(({ request: call }) => call({ request }));

		expect(await setParkedLabel({ settings: jiraQueueSettingsFixture({ parkedLabel: 'queue-parked' }), ticketId: 'LO-1', parked })).toBeUndefined();
		expect(request).toHaveBeenCalledTimes(1);
	});

	test('passes REST failures through unchanged', async () => {
		mockRunJira.mockResolvedValue({ error: 'denied' });

		expect(await setParkedLabel({ settings: jiraQueueSettingsFixture({ parkedLabel: 'queue-parked' }), ticketId: 'LO-1', parked: true })).toStrictEqual({
			error: 'denied',
		});
	});
});
