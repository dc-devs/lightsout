import { messageOf } from '#src/common/utils/messageOf.ts';
import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { JiraTrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import type { JiraAttachment } from '#src/ticketTracker/jira/getTicketAttachments.ts';
import { runJira } from '#src/ticketTracker/jira/runJira.ts';

interface Params {
	settings: JiraTrackerSettings;
	ticketId: string;
	title: string;
	content: Buffer;
	contentType: string;
}

interface AttachmentsResponse {
	fields: { attachment?: JiraAttachment[] | null };
}

export const setTicketAttachment = async ({ settings, ticketId, title, content, contentType }: Params): Promise<TrackerFailure | undefined> =>
	runJira({
		settings,
		request: async (client) => {
			const issuePath = `/rest/api/3/issue/${encodeURIComponent(ticketId)}`;
			const issue = await client.request<AttachmentsResponse>({ method: 'GET', path: `${issuePath}?fields=attachment`, response: 'json' });
			const oldAttachments = (issue.fields.attachment ?? []).filter((attachment) => attachment.filename === title);
			const body = new FormData();
			body.append('file', new Blob([new Uint8Array(content)], { type: contentType }), title);

			const uploaded = await client.request<JiraAttachment[]>({
				method: 'POST',
				path: `${issuePath}/attachments`,
				body,
				headers: { 'X-Atlassian-Token': 'no-check' },
				response: 'json',
			});

			if (!uploaded.some((attachment) => attachment.filename === title)) {
				return { error: `Jira accepted the upload for '${title}' but did not report a linked attachment` };
			}

			for (const attachment of oldAttachments) {
				try {
					await client.request({ method: 'DELETE', path: `/rest/api/3/attachment/${encodeURIComponent(attachment.id)}`, response: 'empty' });
				} catch (error) {
					return {
						error: `Jira linked the new '${title}' but could not delete old attachment '${attachment.id}': ${messageOf({ error })}; duplicate copies remain`,
					};
				}
			}

			return undefined;
		},
	});
