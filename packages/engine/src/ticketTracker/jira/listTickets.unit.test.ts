import { describe, expect, jest, test } from '@jest/globals';
import { listTickets } from '#src/ticketTracker/jira/listTickets.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';

type JiraCallback = (client: { request: (params: unknown) => Promise<unknown> }) => Promise<unknown>;
const mockRunJira = jest.fn<(params: { settings: unknown; request: JiraCallback }) => Promise<unknown>>();

jest.mock('#src/ticketTracker/jira/runJira.ts', () => ({ runJira: (params: { settings: unknown; request: JiraCallback }) => mockRunJira(params) }));

const description = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] };
const issue = {
	id: '1001',
	key: 'LO-1',
	fields: {
		summary: 'First',
		created: '2026-01-01T00:00:00.000Z',
		description,
		priority: { name: 'Lowest' },
		issuelinks: [
			{ type: { inward: 'is blocked by' }, inwardIssue: { key: 'LO-2', fields: { status: { statusCategory: { key: 'indeterminate' } } } } },
			{ type: { inward: 'is blocked by' }, inwardIssue: { key: 'LO-3', fields: { status: { statusCategory: { key: 'done' } } } } },
			{ type: { inward: 'is blocked by' }, inwardIssue: { key: 'LO-4' } },
			{ type: { inward: 'blocks' }, inwardIssue: { key: 'LO-5' } },
			{ type: { inward: 'is blocked by' }, inwardIssue: { fields: null } },
		],
	},
};

describe('Jira listTickets', () => {
	test('queries all labels once with quoted JQL, requested fields, and token paging', async () => {
		const request = jest
			.fn<(params: unknown) => Promise<unknown>>()
			.mockResolvedValueOnce({ issues: [issue], isLast: false, nextPageToken: 'next' })
			.mockResolvedValueOnce({ issues: [], isLast: true });
		mockRunJira.mockImplementation(({ request: call }) => call({ request }));
		const settings = jiraTrackerSettingsFixture({ project: 'L"O' });

		const result = await listTickets({ settings, labelNames: ['route-direct', 'route-auto-plan'], statuses: ['Ready\\Now', 'Back"log'] });

		expect(request).toHaveBeenNthCalledWith(1, {
			method: 'POST',
			path: '/rest/api/3/search/jql',
			body: {
				jql: 'project = "L\\"O" AND labels IN ("route-direct", "route-auto-plan") AND status IN ("Ready\\\\Now", "Back\\"log")',
				fields: ['summary', 'description', 'priority', 'created', 'labels', 'status', 'issuelinks'],
			},
			response: 'json',
		});
		expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({ body: expect.objectContaining({ nextPageToken: 'next' }) }));
		expect(result).toStrictEqual([
			{
				id: '1001',
				identifier: 'LO-1',
				title: 'First',
				description: 'Body',
				priority: 5,
				createdAt: '2026-01-01T00:00:00.000Z',
				labels: [],
				unfinishedBlockers: ['LO-2', 'LO-4'],
			},
		]);
	});

	test.each([
		{ name: 'Highest', priority: 1 },
		{ name: 'High', priority: 2 },
		{ name: 'Medium', priority: 3 },
		{ name: 'Low', priority: 4 },
		{ name: 'Lowest', priority: 5 },
	])('maps Jira priority $name to queue priority $priority', async ({ name, priority }) => {
		const prioritizedIssue = { ...issue, fields: { ...issue.fields, priority: { name } } };
		mockRunJira.mockImplementation(({ request: call }) => call({ request: () => Promise.resolve({ issues: [prioritizedIssue], isLast: true }) }));

		const result = await listTickets({ settings: jiraTrackerSettingsFixture(), labelNames: ['route-direct'], statuses: ['Ready'] });

		expect(result).toEqual([expect.objectContaining({ priority })]);
	});

	test('returns without making a request when no status is eligible', async () => {
		mockRunJira.mockClear();

		expect(await listTickets({ settings: jiraTrackerSettingsFixture(), labelNames: ['route-direct'], statuses: [] })).toStrictEqual([]);
		expect(await listTickets({ settings: jiraTrackerSettingsFixture(), labelNames: [], statuses: ['Ready'] })).toStrictEqual([]);
		expect(mockRunJira).not.toHaveBeenCalled();
	});

	test('fails a nonfinal page without a token', async () => {
		mockRunJira.mockImplementation(({ request: call }) => call({ request: () => Promise.resolve({ issues: [], isLast: false }) }));

		expect(await listTickets({ settings: jiraTrackerSettingsFixture(), labelNames: ['route-direct'], statuses: ['Ready'] })).toStrictEqual({
			error: 'Jira returned a nonfinal search page without a nextPageToken',
		});
	});

	test('propagates malformed descriptions and required-field absences', async () => {
		mockRunJira.mockImplementation(({ request: call }) =>
			call({ request: () => Promise.resolve({ issues: [{ ...issue, fields: { ...issue.fields, description: { bad: true } } }], isLast: true }) }),
		);

		expect(await listTickets({ settings: jiraTrackerSettingsFixture(), labelNames: ['route-direct'], statuses: ['Ready'] })).toStrictEqual({
			error: "Jira issue 'LO-1' has a malformed description",
		});
	});

	test('uses Jira absence fallbacks for description, labels, priority, links, and status', async () => {
		const sparse = {
			id: '1002',
			key: 'LO-2',
			fields: { summary: 'Sparse', created: '2026-01-02T00:00:00.000Z', labels: null, priority: null, issuelinks: null },
		};
		mockRunJira.mockImplementation(({ request: call }) => call({ request: () => Promise.resolve({ issues: [sparse], isLast: true }) }));

		expect(await listTickets({ settings: jiraTrackerSettingsFixture(), labelNames: ['route-direct'], statuses: ['Ready'] })).toEqual([
			expect.objectContaining({ description: '', labels: [], priority: 0, unfinishedBlockers: [] }),
		]);
	});
});
