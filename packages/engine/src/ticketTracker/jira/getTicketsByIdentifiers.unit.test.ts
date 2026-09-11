import { describe, expect, jest, test } from '@jest/globals';
import { getTicketsByIdentifiers } from '#src/ticketTracker/jira/getTicketsByIdentifiers.ts';
import { jiraTrackerSettingsFixture } from '#tests/helpers/jiraQueueSettingsFixture.ts';

type JiraCallback = (client: { request: (params: unknown) => Promise<unknown> }) => Promise<unknown>;
const mockRunJira = jest.fn<(params: { settings: unknown; request: JiraCallback }) => Promise<unknown>>();

jest.mock('#src/ticketTracker/jira/runJira.ts', () => ({ runJira: (params: { settings: unknown; request: JiraCallback }) => mockRunJira(params) }));

const issue = {
	id: '1001',
	key: 'LO-1',
	fields: {
		summary: 'Resume me',
		created: '2026-01-01T00:00:00.000Z',
		description: null,
		labels: ['route-direct', 'route-auto-plan'],
		status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
		issuelinks: [{ type: { inward: 'is blocked by' }, inwardIssue: { key: 'LO-2', fields: null } }],
	},
};

describe('Jira getTicketsByIdentifiers', () => {
	test('filters external keys, omits statuses, returns provider-neutral labels, and pages', async () => {
		const request = jest
			.fn<(params: unknown) => Promise<unknown>>()
			.mockResolvedValueOnce({ issues: [issue], isLast: false, nextPageToken: 'page-2' })
			.mockResolvedValueOnce({ issues: [], isLast: true });
		mockRunJira.mockImplementation(({ request: call }) => call({ request }));

		const result = await getTicketsByIdentifiers({ settings: jiraTrackerSettingsFixture(), identifiers: ['LO-1', 'OTHER-2'] });

		expect(request).toHaveBeenNthCalledWith(1, {
			method: 'POST',
			path: '/rest/api/3/search/jql',
			body: {
				jql: 'project = "LO" AND key IN ("LO-1")',
				fields: ['summary', 'description', 'priority', 'created', 'labels', 'status', 'issuelinks'],
			},
			response: 'json',
		});
		expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({ body: expect.objectContaining({ nextPageToken: 'page-2' }) }));
		expect(result).toStrictEqual([
			{
				id: '1001',
				identifier: 'LO-1',
				title: 'Resume me',
				url: 'https://example.atlassian.net/browse/LO-1',
				description: '',
				priority: 0,
				createdAt: '2026-01-01T00:00:00.000Z',
				labels: ['route-direct', 'route-auto-plan'],
				status: 'In Progress',
				finished: false,
				unfinishedBlockers: ['LO-2'],
			},
		]);
	});

	test.each<{ identifiers: string[] }>([{ identifiers: [] }, { identifiers: ['OTHER-1'] }])(
		'returns without a request when no configured-project keys remain',
		async ({ identifiers }) => {
			mockRunJira.mockClear();

			expect(await getTicketsByIdentifiers({ settings: jiraTrackerSettingsFixture(), identifiers })).toStrictEqual([]);
			expect(mockRunJira).not.toHaveBeenCalled();
		},
	);

	test('quotes every exact key and still returns a ticket after route labels are removed', async () => {
		const request = jest
			.fn<(params: unknown) => Promise<unknown>>()
			.mockResolvedValue({ issues: [{ ...issue, fields: { ...issue.fields, labels: [] } }], isLast: true });
		mockRunJira.mockImplementation(({ request: call }) => call({ request }));

		expect(await getTicketsByIdentifiers({ settings: jiraTrackerSettingsFixture({ project: 'L"O', ticketPrefix: 'L"O' }), identifiers: ['L"O-1'] })).toEqual([
			expect.objectContaining({ labels: [] }),
		]);
		expect(request).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ jql: 'project = "L\\"O" AND key IN ("L\\"O-1")' }) }));
	});

	test('propagates summary and paging failures', async () => {
		mockRunJira.mockImplementationOnce(({ request: call }) =>
			call({ request: () => Promise.resolve({ issues: [{ ...issue, fields: { ...issue.fields, summary: undefined } }], isLast: true }) }),
		);
		expect(await getTicketsByIdentifiers({ settings: jiraTrackerSettingsFixture(), identifiers: ['LO-1'] })).toStrictEqual({
			error: "Jira issue 'LO-1' is missing its summary or created value",
		});

		mockRunJira.mockImplementationOnce(({ request: call }) => call({ request: () => Promise.resolve({ issues: [], isLast: false }) }));
		expect(await getTicketsByIdentifiers({ settings: jiraTrackerSettingsFixture(), identifiers: ['LO-1'] })).toStrictEqual({
			error: 'Jira returned a nonfinal search page without a nextPageToken',
		});
	});

	test('carries the finished flag on a ticket looked up by key, which is the lookup a parked worktree makes', async () => {
		const doneIssue = { ...issue, fields: { ...issue.fields, status: { name: 'Done', statusCategory: { key: 'done' } } } };
		mockRunJira.mockImplementation(({ request: call }) => call({ request: () => Promise.resolve({ issues: [doneIssue], isLast: true }) }));

		const result = await getTicketsByIdentifiers({ settings: jiraTrackerSettingsFixture(), identifiers: ['LO-1'] });

		expect(result).toEqual([expect.objectContaining({ identifier: 'LO-1', status: 'Done', finished: true })]);
	});

	test('builds the url of a ticket looked up by key from the configured site, so a parked ticket links like a fresh one', async () => {
		mockRunJira.mockImplementation(({ request: call }) => call({ request: () => Promise.resolve({ issues: [issue], isLast: true }) }));

		const result = await getTicketsByIdentifiers({ settings: jiraTrackerSettingsFixture({ siteUrl: 'https://acme.atlassian.net' }), identifiers: ['LO-1'] });

		expect(result).toEqual([expect.objectContaining({ identifier: 'LO-1', url: 'https://acme.atlassian.net/browse/LO-1' })]);
	});

	test('fails the read when a status carries no category — a ticket whose finishedness is unknown must never be reported as unfinished', async () => {
		const uncategorizedIssue = { ...issue, fields: { ...issue.fields, status: { name: 'In Progress' } } };
		mockRunJira.mockImplementation(({ request: call }) => call({ request: () => Promise.resolve({ issues: [uncategorizedIssue], isLast: true }) }));

		const result = await getTicketsByIdentifiers({ settings: jiraTrackerSettingsFixture(), identifiers: ['LO-1'] });

		expect(result).toStrictEqual({ error: "Jira issue 'LO-1' has a status that carries no category" });
	});
});
