import type { TrackerAttachment } from '#src/ticketTracker/common/types/TrackerAttachment.ts';
import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { JiraTrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { runJira } from '#src/ticketTracker/jira/runJira.ts';

interface Params {
	settings: JiraTrackerSettings;
	identifier: string;
}

export interface JiraAttachment {
	id: string;
	filename: string;
}

interface AttachmentsResponse {
	fields: { attachment?: JiraAttachment[] | null };
}

const issueKeyOf = ({ identifier, ticketPrefix }: { identifier: string; ticketPrefix: string }) => {
	const [prefix, number] = identifier.split('-');

	return prefix?.toLowerCase() === ticketPrefix.toLowerCase() && /^\d+$/u.test(number ?? '') ? `${ticketPrefix}-${number}` : undefined;
};

export const getTicketAttachments = async ({ settings, identifier }: Params): Promise<TrackerAttachment[] | TrackerFailure> => {
	const issueKey = issueKeyOf({ identifier, ticketPrefix: settings.ticketPrefix });

	if (issueKey === undefined) {
		return { error: `'${identifier}' names no ticket number` };
	}

	return runJira({
		settings,
		request: async (client) => {
			const issue = await client.request<AttachmentsResponse>({
				method: 'GET',
				path: `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=attachment`,
				response: 'json',
			});

			return (issue.fields.attachment ?? []).map(({ id, filename }) => ({
				id,
				title: filename,
				url: new URL(`/rest/api/3/attachment/content/${encodeURIComponent(id)}`, settings.siteUrl).toString(),
			}));
		},
	});
};
