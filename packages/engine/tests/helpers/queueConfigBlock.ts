/**
 * The `queue` block a repo writes into `lightsout.config.json`, in the file's
 * own kebab-case spelling — the raw counterpart of `queueSettingsFixture`,
 * which is the block after resolution.
 *
 * One copy rather than one per test file, for the same reason: it is the
 * smallest block `ConfigQueue` accepts, so a new required key is added here
 * once instead of in every file that plants a config.
 */
export const queueConfigBlock = {
	'max-parallel': 2,
};

/**
 * The `ticket-tracker` block that names who the engine talks to about a ticket.
 *
 * It lives beside the queue block rather than in a file of its own because the
 * two are planted together by every test that plants either — a queue that
 * cannot reach a tracker starts no drain, and a config carrying only identity
 * runs no queue.
 */
export const ticketTrackerConfigBlock = {
	provider: 'linear',
	team: 'LO',
	'api-key-env': 'LINEAR_API_KEY',
};

/** The Jira branch of the same top-level tracker contract. */
export const jiraTicketTrackerConfigBlock = {
	provider: 'jira',
	'site-url': 'https://example.atlassian.net',
	project: 'LO',
	'api-key-env': 'JIRA_API_TOKEN',
	'api-user-email-env': 'JIRA_ACCOUNT_EMAIL',
};
