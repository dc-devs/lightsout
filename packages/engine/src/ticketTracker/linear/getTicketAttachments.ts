import type { TrackerAttachment } from '#src/ticketTracker/common/types/TrackerAttachment.ts';
import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { LinearTrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { collectNodes } from '#src/ticketTracker/linear/common/utils/collectNodes.ts';
import { runLinear } from '#src/ticketTracker/linear/runLinear.ts';

interface Params {
	settings: LinearTrackerSettings;
	/** The ticket reference a plan folder's name carries, e.g. 'lo-54' — matched case-insensitively by number. */
	identifier: string;
}

/**
 * Every attachment on one ticket.
 *
 * The read half of the pair whose write half is `setTicketAttachment`. They are
 * separate files so a caller that only needs to see what is on a ticket never
 * pulls an upload path in with it.
 *
 * A ticket the team does not have is a failure rather than an empty list: a
 * wrong team key and a ticket carrying nothing yet are two different things to
 * fix, and one answer for both would send a reader after the wrong one.
 */
export const getTicketAttachments = async ({ settings, identifier }: Params): Promise<TrackerAttachment[] | TrackerFailure> => {
	const [prefix, number] = identifier.split('-');
	const issueNumber = prefix?.toLowerCase() === settings.ticketPrefix.toLowerCase() && /^\d+$/u.test(number ?? '') ? Number(number) : Number.NaN;

	if (!Number.isFinite(issueNumber)) {
		return { error: `'${identifier}' names no ticket number` };
	}

	return runLinear({
		apiKey: settings.apiKey,
		call: async (client) => {
			const connection = await client.issues({ filter: { team: { key: { eq: settings.team } }, number: { eq: issueNumber } } });
			const issue = (await collectNodes({ connection })).at(0);

			if (issue === undefined) {
				return { error: `no ticket '${identifier}' in team ${settings.team}` };
			}

			// Paged to exhaustion for the reason the backlog is: a phased plan can
			// carry a dozen attachments, and a truncated list restores a plan
			// missing its later phases.
			const attachments = await collectNodes({ connection: await issue.attachments() });

			return attachments.map(({ id, title, url }) => ({ id, title, url }));
		},
	});
};
