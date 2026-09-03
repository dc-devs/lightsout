import { describe, expect, jest, test } from '@jest/globals';
import { listLabelNames } from '#src/ticketTracker/jira/listLabelNames.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';

type JiraCallback = (client: { request: (params: unknown) => Promise<unknown> }) => Promise<unknown>;
const mockRunJira = jest.fn<(params: { settings: unknown; request: JiraCallback }) => Promise<unknown>>();

jest.mock('#src/ticketTracker/jira/runJira.ts', () => ({ runJira: (params: { settings: unknown; request: JiraCallback }) => mockRunJira(params) }));

const listConfigured = () => listLabelNames({ settings: jiraTrackerSettingsFixture() });

describe('Jira listLabelNames', () => {
	test('walks the catalog by offset until the last page, asking for a fixed page size every time', async () => {
		const request = jest
			.fn<(params: unknown) => Promise<unknown>>()
			.mockResolvedValueOnce({ values: ['planning-complete', 'planning-not-needed'], isLast: false })
			.mockResolvedValueOnce({ values: ['planning-needs-plan'], isLast: true });
		mockRunJira.mockImplementation(({ request: call }) => call({ request }));

		expect(await listConfigured()).toStrictEqual(['planning-complete', 'planning-not-needed', 'planning-needs-plan']);

		expect(request).toHaveBeenNthCalledWith(1, { method: 'GET', path: '/rest/api/3/label?startAt=0&maxResults=200', response: 'json' });
		expect(request).toHaveBeenNthCalledWith(2, { method: 'GET', path: '/rest/api/3/label?startAt=2&maxResults=200', response: 'json' });
	});

	test('answers an empty catalog when the only page is final and carries no labels, rather than reading it as a stuck page', async () => {
		const request = jest.fn<(params: unknown) => Promise<unknown>>().mockResolvedValue({ values: [], isLast: true });
		mockRunJira.mockImplementation(({ request: call }) => call({ request }));

		expect(await listConfigured()).toStrictEqual([]);

		expect(request).toHaveBeenCalledTimes(1);
	});

	test('says so when a nonfinal page carries no values, rather than asking for the same offset forever', async () => {
		mockRunJira.mockImplementation(({ request: call }) => call({ request: () => Promise.resolve({ values: [], isLast: false }) }));

		expect(await listConfigured()).toStrictEqual({ error: 'Jira returned a nonfinal label page with no values' });
	});

	test('hands a request failure back rather than swallowing it — an unreadable catalog must never read as an empty one', async () => {
		mockRunJira.mockResolvedValue({ error: 'Jira request failed with 401' });

		expect(await listConfigured()).toStrictEqual({ error: 'Jira request failed with 401' });
	});
});
