import { z } from 'zod';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { TicketRecord } from '#src/contracts/index.ts';
import { ticketFileNames } from '#src/ticket/common/constants/ticketFileNames.ts';
import type { PublishedTicketRecord } from '#src/ticket/common/types/PublishedTicketRecord.ts';
import type { TicketTrackerTarget } from '#src/ticket/common/types/TicketTrackerTarget.ts';
import { serializeTicketRecord } from '#src/ticket/common/utils/serializeTicketRecord.ts';
import { getTicketAttachments, readTicketAsset } from '#src/ticketTracker/index.ts';

interface Params {
	target: TicketTrackerTarget;
	/** The ticket folder's name, which the published record must also name as its branch. */
	ticketBranch: string;
}

/** Whatever the attachment held, read as a record of this ticket — or the one sentence saying why it is not one. */
const readRecordText = ({ text, ticketBranch, ticketRef }: { text: string; ticketBranch: string; ticketRef: string }) => {
	let value: unknown;
	let outcome: { published: PublishedTicketRecord } | { error: string } | undefined;

	try {
		value = JSON.parse(text);
	} catch (error) {
		outcome = {
			error: `the ${ticketFileNames.record} on ${ticketRef} is not valid JSON (${messageOf({ error })}) — run \`lightsout ticket sync --name ${ticketBranch} --keep local\` to replace it with this machine's record`,
		};
	}

	if (outcome === undefined) {
		const parsed = TicketRecord.safeParse(value);

		if (!parsed.success) {
			outcome = {
				error: `the ${ticketFileNames.record} on ${ticketRef} does not match the ticket record contract (${z.prettifyError(parsed.error)}) — run \`lightsout ticket sync --name ${ticketBranch} --keep local\` to replace it with this machine's record`,
			};
		} else if (parsed.data.branch !== ticketBranch) {
			outcome = {
				error: `the ${ticketFileNames.record} on ${ticketRef} names branch '${parsed.data.branch}', not the '${ticketBranch}' ticket it was read for`,
			};
		} else {
			outcome = { published: { record: parsed.data, content: serializeTicketRecord({ record: parsed.data }) } };
		}
	}

	return outcome;
};

/**
 * The ticket's own copy of its record, or the fact that it carries none.
 *
 * The bytes answered are `serializeTicketRecord`'s, not the attachment's own
 * text: that is what lets a copy published by an older or differently-ordered
 * writer still compare equal to an identical local record by hash.
 */
export const readPublishedTicketRecord = async ({
	target,
	ticketBranch,
}: Params): Promise<{ published: PublishedTicketRecord | undefined } | { error: string }> => {
	const { settings, ticketRef } = target;
	const attachments = await getTicketAttachments({ settings, identifier: ticketRef });

	if ('error' in attachments) {
		return { error: `the ${ticketFileNames.record} on ${ticketRef} could not be read: ${attachments.error}` };
	}

	const carried = attachments.filter(({ title }) => title === ticketFileNames.record);

	if (carried.length > 1) {
		return {
			error: `${ticketRef} carries more than one ${ticketFileNames.record} attachment, so no single published ticket record can be selected — remove the extra one on the ticket, or run \`lightsout ticket sync --name ${ticketBranch} --keep local\` to publish this machine's record over them`,
		};
	}

	const attachment = carried[0];

	if (attachment === undefined) {
		return { published: undefined };
	}

	const text = await readTicketAsset({ settings, url: attachment.url });

	return typeof text === 'string'
		? readRecordText({ text, ticketBranch, ticketRef })
		: { error: `the ${ticketFileNames.record} on ${ticketRef} could not be read: ${text.error}` };
};
