import { attachmentTitle } from '#src/common/attachmentManifest/attachmentTitle.ts';
import type { PreparedAttachment } from '#src/plan/publish/common/types/PreparedAttachment.ts';
import { setTicketAttachment, type TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	settings: TrackerSettings;
	ticketId: string;
	ticketRef: string;
	attachments: PreparedAttachment[];
	onProgress: (message: string) => void;
	/** The plan id every title is namespaced under; absent for a legacy folder, whose titles stay bare. */
	titlePrefix?: string;
}

/** The tracker previews an attachment by its content type, and the durable set holds only these two shapes. */
const contentTypeOf = ({ name }: { name: string }) => (name.endsWith('.json') ? 'application/json' : 'text/markdown');

/** Attach the prepared snapshot in order, with its manifest last, stopping at the first tracker refusal. */
export const attachDurableFiles = async ({
	settings,
	ticketId,
	ticketRef,
	attachments,
	onProgress,
	titlePrefix,
}: Params): Promise<{ published: string[]; error?: string }> => {
	const published: string[] = [];

	for (const attachment of attachments) {
		const title = attachmentTitle({ prefix: titlePrefix, name: attachment.name });
		const failure = await setTicketAttachment({
			settings,
			ticketId,
			title,
			content: attachment.content,
			contentType: contentTypeOf({ name: attachment.name }),
		});

		// A stopped loop keeps what did land, so a partial publish is visible
		// rather than silent.
		if (failure !== undefined) {
			return { published, error: failure.error };
		}

		published.push(title);
		onProgress(`attached ${title} to ${ticketRef}`);
	}

	return { published };
};
