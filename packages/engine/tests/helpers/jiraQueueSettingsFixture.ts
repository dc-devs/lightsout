import type { QueueSettings } from '#src/queue/index.ts';

type JiraQueueSettings = Extract<QueueSettings, { tracker: 'jira' }>;

export const jiraQueueSettingsFixture = (overrides: Partial<JiraQueueSettings> = {}): JiraQueueSettings => ({
	tracker: 'jira',
	ticketPrefix: 'LO',
	siteUrl: 'https://example.atlassian.net',
	project: 'LO',
	apiUserEmail: 'person@example.com',
	routeLabels: { direct: 'route-direct', 'auto-plan': 'route-auto-plan' },
	maxParallel: 2,
	apiKey: 'jira-token',
	eligibleStatuses: ['Backlog'],
	inProgressStatus: 'In Progress',
	branchTemplate: '{ticket}-{slug}',
	decisionsHeading: '## Decisions',
	workerTimeoutMs: 14_400_000,
	questionTimeoutMs: 3_600_000,
	...overrides,
});
