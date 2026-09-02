import { messageOf } from '#src/common/utils/messageOf.ts';
import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { LinearTrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { collectNodes } from '#src/ticketTracker/linear/common/utils/collectNodes.ts';
import { runLinear } from '#src/ticketTracker/linear/runLinear.ts';

interface Params {
	settings: LinearTrackerSettings;
	/** The ticket's internal id, from `TrackerTicket.id` — the same thing every other write here takes. */
	ticketId: string;
	/** The attachment's title AND the uploaded file's name: one durable file's own name, e.g. 'plan.md'. */
	title: string;
	content: Buffer;
	/** The upload's content type, e.g. 'text/markdown'. */
	contentType: string;
}

/**
 * Put one file on a ticket as a named attachment, replacing any attachment
 * already carrying that title.
 *
 * The replace is what makes a second publish a replacement rather than a
 * doubling: two attachments named for the same file would leave a fetch
 * choosing between them.
 *
 * The read and both writes share one call, so they cannot end up on different
 * deadlines — the rule `appendTicketNote` already follows.
 */
export const setTicketAttachment = async ({ settings, ticketId, title, content, contentType }: Params): Promise<TrackerFailure | undefined> => {
	return runLinear({
		apiKey: settings.apiKey,
		call: async (client) => {
			const issue = await client.issue(ticketId);
			// Paged: an issue carries attachments other integrations wrote, and a
			// same-titled one on the second page would survive as a duplicate.
			const attachments = await collectNodes({ connection: await issue.attachments() });

			const payload = await client.fileUpload(contentType, title, content.byteLength);
			const uploadFile = payload.uploadFile;

			if (uploadFile === undefined || uploadFile === null) {
				return { error: `the tracker did not prepare an upload for '${title}'` };
			}

			const headers = Object.fromEntries(uploadFile.headers.map(({ key, value }): [string, string] => [key, value]));
			// `fetch` takes a view over a plain ArrayBuffer; a Node Buffer may sit on
			// any buffer kind, so copy the bytes into one the request body accepts.
			const body = new Uint8Array(content);
			const response = await fetch(uploadFile.uploadUrl, {
				method: 'PUT',
				headers: { ...headers, 'Cache-Control': 'public, max-age=31536000', 'Content-Type': contentType },
				body,
			});

			if (!response.ok) {
				return { error: `uploading '${title}' failed: ${response.status} ${response.statusText}` };
			}

			const created = await client.createAttachment({ issueId: ticketId, title, url: uploadFile.assetUrl });

			if (!created.success) {
				return { error: `the tracker uploaded '${title}' but did not link it to the ticket` };
			}

			for (const attachment of attachments.filter((candidate) => candidate.title === title)) {
				let deleted: Awaited<ReturnType<typeof client.deleteAttachment>>;

				try {
					deleted = await client.deleteAttachment(attachment.id);
				} catch (error) {
					return {
						error: `the tracker linked the new '${title}' but could not delete old attachment '${attachment.id}': ${messageOf({ error })}; duplicate copies remain`,
					};
				}

				if (!deleted.success) {
					return { error: `the tracker linked the new '${title}' but could not delete old attachment '${attachment.id}'; duplicate copies remain` };
				}
			}

			return undefined;
		},
	});
};
