import { z } from 'zod';

const jiraSiteUrl = z
	.string()
	.url()
	.refine((value) => {
		let url: URL;

		try {
			url = new URL(value);
		} catch {
			return false;
		}

		return url.protocol === 'https:' && url.hostname.endsWith('.atlassian.net') && url.pathname === '/' && url.search === '' && url.hash === '';
	}, 'Jira site-url must be an HTTPS *.atlassian.net origin');

/**
 * The optional `ticket-tracker` block of `lightsout.config.json` — who the
 * engine talks to about tickets, where that provider lives, and how it
 * authenticates.
 *
 * Tracker identity is one fact, spelled once. It sits above `queue` rather than
 * inside it because the queue is no longer its only reader: publishing a plan to
 * its ticket needs a provider connection without needing a queue at all, and
 * two spellings of one fact would let those callers disagree about which team
 * or project a ticket lives in.
 *
 * `.strict()` for the same reason `ConfigShip` is strict: the rest of the config
 * strips unknown keys, and a typo here would silently disable a setting the user
 * believes is active.
 */
export const ConfigTicketTracker = z.discriminatedUnion('provider', [
	z
		.object({
			/** Which tracker the engine talks to. */
			provider: z.literal('linear'),
			/** The Linear team key, e.g. 'LO' — every query is scoped to it. */
			team: z.string().min(1, 'Linear trackers need a team'),
			/** Name of the environment variable holding the Linear API key. The key itself is never written to config. */
			'api-key-env': z.string().min(1, 'Linear trackers need an api-key-env'),
		})
		.strict(),
	z
		.object({
			/** Which tracker the engine talks to. */
			provider: z.literal('jira'),
			/** The Jira Cloud origin, normalized by the settings resolver before requests are made. */
			'site-url': jiraSiteUrl,
			/** The Jira project key, e.g. 'LO' — every query is scoped to it. */
			project: z.string().min(1, 'Jira trackers need a project'),
			/** Name of the environment variable holding the Jira API token. */
			'api-key-env': z.string().min(1, 'Jira trackers need an api-key-env'),
			/** Name of the environment variable holding the Jira account email paired with that token. */
			'api-user-email-env': z.string().min(1, 'Jira trackers need an api-user-email-env'),
		})
		.strict(),
]);

export type ConfigTicketTracker = z.infer<typeof ConfigTicketTracker>;
