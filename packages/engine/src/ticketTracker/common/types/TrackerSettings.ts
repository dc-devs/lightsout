interface BaseTrackerSettings {
	/** The human-reference prefix, e.g. `LO` in `LO-54`. */
	ticketPrefix: string;
	/** The key itself, read from the configured environment variable. Never logged. */
	apiKey: string;
}

export interface LinearTrackerSettings extends BaseTrackerSettings {
	provider: 'linear';
	/** Linear's team key. */
	team: string;
}

export interface JiraTrackerSettings extends BaseTrackerSettings {
	provider: 'jira';
	/** The configured Jira Cloud origin, normalized without a trailing slash. */
	siteUrl: string;
	/** Jira's project key. */
	project: string;
	/** Account email paired with the API token for Basic authentication. */
	apiUserEmail: string;
}

/** Provider identity and credentials needed by the tracker seam, with no queue policy mixed in. */
export type TrackerSettings = LinearTrackerSettings | JiraTrackerSettings;
