import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { JiraTrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { runJira } from '#src/ticketTracker/jira/runJira.ts';

interface LabelPage {
	values: string[];
	isLast: boolean;
}

interface Params {
	settings: JiraTrackerSettings;
}

/**
 * Every label name this Jira instance knows about, paged to exhaustion.
 *
 * The endpoint is instance-wide rather than project-scoped, because Jira Cloud
 * publishes no project-scoped label catalog. That is sound for the one question
 * a caller asks — does this label exist — since an instance-wide answer is a
 * superset of the project's.
 *
 * A caller reporting a missing label must therefore tell the user to apply that
 * label to any issue in the project. Never "create the label": a Jira label
 * comes into being the first time an issue carries it, so creating one is an
 * action Jira does not offer.
 */
export const listLabelNames = async ({ settings }: Params): Promise<string[] | TrackerFailure> =>
	runJira({
		settings,
		request: async (client) => {
			// Large enough that an ordinary catalog arrives in one round trip, small
			// enough to sit inside any server cap. Sending none would let the engine
			// reason over a server default it does not control, and a truncated
			// catalog reports a configured label as missing when it exists.
			const labelPageSize = 200;
			const names: string[] = [];
			let startAt = 0;
			let isLast = false;

			do {
				const path = `/rest/api/3/label?startAt=${startAt}&maxResults=${labelPageSize}`;
				const page = await client.request<LabelPage>({ method: 'GET', path, response: 'json' });

				if (!page.isLast && page.values.length === 0) {
					return { error: 'Jira returned a nonfinal label page with no values' };
				}

				names.push(...page.values);
				startAt += page.values.length;
				isLast = page.isLast;
			} while (!isLast);

			return names;
		},
	});
