import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { JiraTrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import type { JiraIssue } from '#src/ticketTracker/jira/common/types/JiraIssue.ts';
import { runJira } from '#src/ticketTracker/jira/runJira.ts';

interface Params {
	settings: JiraTrackerSettings;
	ticketId: string;
	label: string;
	groupLabels: string[];
}

type LabelOperation = { add: string } | { remove: string };

/**
 * Makes `label` the one member of `groupLabels` the ticket carries.
 *
 * Labels outside `groupLabels` are never touched, and writing nothing is a
 * legitimate outcome: a ticket already carrying exactly `label` costs one read
 * and no write. Jira takes the whole add-and-remove set in one update, so an
 * exclusive write is a single request.
 *
 * Unlike Linear's half, this never fails for a label that does not exist yet,
 * and that asymmetry is deliberate rather than a missing guard: a Jira label
 * comes into being the first time an issue carries it, so there is no catalog
 * entry to check against at write time. Whether a configured label exists is
 * answered for both providers by `listLabelNames`, at the caller's startup.
 */
export const setExclusiveLabel = async ({ settings, ticketId, label, groupLabels }: Params): Promise<TrackerFailure | undefined> => {
	const path = `/rest/api/3/issue/${encodeURIComponent(ticketId)}`;

	return runJira({
		settings,
		request: async (client) => {
			const issue = await client.request<JiraIssue>({ method: 'GET', path: `${path}?fields=labels`, response: 'json' });
			const carried = issue.fields.labels ?? [];
			const operations: LabelOperation[] = [
				...(carried.includes(label) ? [] : [{ add: label }]),
				...groupLabels.filter((name) => name !== label && carried.includes(name)).map((name) => ({ remove: name })),
			];

			if (operations.length > 0) {
				await client.request({ method: 'PUT', path, body: { update: { labels: operations } }, response: 'empty' });
			}

			return undefined;
		},
	});
};
