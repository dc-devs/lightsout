import { attachmentTitle } from '#src/common/attachmentManifest/attachmentTitle.ts';
import { scopeAttachments } from '#src/common/attachmentManifest/scopeAttachments.ts';
import { durablePlanFileNames } from '#src/plan/common/constants/durablePlanFileNames.ts';
import { isPlanOnlyAttachmentName } from '#src/plan/common/utils/isPlanOnlyAttachmentName.ts';
import { getTicketAttachments, type TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	settings: TrackerSettings;
	ticketRef: string;
	/** The titles this run wrote, which are by definition not stale. */
	published: string[];
	onProgress: (message: string) => void;
	/** The plan id the titles are namespaced under; absent for a legacy folder. */
	titlePrefix?: string;
}

/**
 * Every attachment title on the ticket that names a durable plan file of THIS
 * generation which this run did not write.
 *
 * Under a prefix the list is narrowed to the plan's own namespace first, so
 * another plan's titles, this plan's brainstorm titles and the ticket record
 * are all outside the question rather than answers to it. `brainstorm-notes.md`
 * is excluded there because the brainstorm generation owns it — a title this
 * generation deliberately does not write is not one it left behind.
 */
const readStaleTitles = ({ titles, published, titlePrefix }: { titles: string[]; published: string[]; titlePrefix?: string }) => {
	const scoped = scopeAttachments({ attachments: titles.map((title) => ({ title })), prefix: titlePrefix });
	const names = scoped
		.map(({ title }) => title)
		.filter((name) =>
			titlePrefix === undefined
				? durablePlanFileNames.records.includes(name) || durablePlanFileNames.deliverable.test(name)
				: isPlanOnlyAttachmentName({ name }),
		);

	return names.map((name) => attachmentTitle({ prefix: titlePrefix, name })).filter((title) => !published.includes(title));
};

/**
 * Name the durable-titled attachments an earlier publish left on the ticket,
 * and answer with them.
 *
 * The read is advisory: one that did not come back reports itself and answers
 * with nothing, because the files are already on the ticket and a publish that
 * succeeded must not be turned into a reported failure by it.
 */
export const reportStaleAttachments = async ({ settings, ticketRef, published, onProgress, titlePrefix }: Params): Promise<string[]> => {
	const attachments = await getTicketAttachments({ settings, identifier: ticketRef });

	if ('error' in attachments) {
		onProgress(`could not read ${ticketRef}'s attachment list back: ${attachments.error}`);

		return [];
	}

	const stale = readStaleTitles({ titles: attachments.map((attachment) => attachment.title), published, titlePrefix });

	for (const title of stale) {
		onProgress(`${title} is a plan file from an earlier publish that this run did not write — it is still on ${ticketRef}, and publish deleted nothing`);
	}

	return stale;
};
