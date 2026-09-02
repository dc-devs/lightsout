import type { TrackerSettings } from '#src/ticketTracker/index.ts';

type JiraTrackerSettings = Extract<TrackerSettings, { provider: 'jira' }>;

/** A resolved Jira tracker identity. Kept in the existing helper file so the recovery does not churn every Jira test at once. */
export const jiraTrackerSettingsFixture = (overrides: Partial<JiraTrackerSettings> = {}): JiraTrackerSettings => ({
	provider: 'jira',
	ticketPrefix: 'LO',
	siteUrl: 'https://example.atlassian.net',
	project: 'LO',
	apiUserEmail: 'person@example.com',
	apiKey: 'jira-token',
	...overrides,
});

/** @deprecated Use `jiraTrackerSettingsFixture`; retained while Jira tests move from queue-owned identity. */
export const jiraQueueSettingsFixture = jiraTrackerSettingsFixture;
