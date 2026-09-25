import { z } from 'zod';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import { getTicketAttachments } from '#src/ticketTracker/getTicketAttachments.ts';
import { readTicketAsset } from '#src/ticketTracker/readTicketAsset.ts';
import { workOrderFileNames } from '#src/workOrder/common/constants/workOrderFileNames.ts';
import type { PublishedWorkOrderState } from '#src/workOrder/common/types/PublishedWorkOrderState.ts';
import type { TicketTrackerTarget } from '#src/workOrder/common/types/TicketTrackerTarget.ts';
import { serializeWorkOrderState } from '#src/workOrder/common/utils/serializeWorkOrderState.ts';

interface Params {
	target: TicketTrackerTarget;
	/** The work order's label, which the published record must also name as its own. */
	name: string;
}

/** Whatever the attachment held, read as a record of this ticket — or the one sentence saying why it is not one. */
const readRecordText = ({ text, name, ticketRef }: { text: string; name: string; ticketRef: string }) => {
	let value: unknown;
	let outcome: { published: PublishedWorkOrderState } | { error: string } | undefined;

	try {
		value = JSON.parse(text);
	} catch (error) {
		outcome = {
			error: `the ${workOrderFileNames.record} on ${ticketRef} is not valid JSON (${messageOf({ error })}) — run \`lightsout work-order sync --name ${name} --keep local\` to replace it with this machine's record`,
		};
	}

	if (outcome === undefined) {
		const parsed = WorkOrderState.safeParse(value);

		if (!parsed.success) {
			outcome = {
				error: `the ${workOrderFileNames.record} on ${ticketRef} does not match the work order state contract (${z.prettifyError(parsed.error)}) — run \`lightsout work-order sync --name ${name} --keep local\` to replace it with this machine's record`,
			};
		} else if (parsed.data.name !== name) {
			outcome = {
				error: `the ${workOrderFileNames.record} on ${ticketRef} names work order '${parsed.data.name}', not the '${name}' work order it was read for`,
			};
		} else {
			outcome = { published: { record: parsed.data, content: serializeWorkOrderState({ record: parsed.data }) } };
		}
	}

	return outcome;
};

/**
 * The ticket's own copy of its record, or the fact that it carries none.
 *
 * The bytes answered are `serializeWorkOrderState`'s, not the attachment's own
 * text: that is what lets a copy published by an older or differently-ordered
 * writer still compare equal to an identical local record by hash.
 */
export const readPublishedWorkOrderState = async ({
	target,
	name,
}: Params): Promise<{ published: PublishedWorkOrderState | undefined } | { error: string }> => {
	const { settings, ticketRef } = target;
	const attachments = await getTicketAttachments({ settings, identifier: ticketRef });

	if ('error' in attachments) {
		return { error: `the ${workOrderFileNames.record} on ${ticketRef} could not be read: ${attachments.error}` };
	}

	const carried = attachments.filter(({ title }) => title === workOrderFileNames.record);

	if (carried.length > 1) {
		return {
			error: `${ticketRef} carries more than one ${workOrderFileNames.record} attachment, so no single published work order state can be selected — remove the extra one on the ticket, or run \`lightsout work-order sync --name ${name} --keep local\` to publish this machine's record over them`,
		};
	}

	const attachment = carried[0];

	if (attachment === undefined) {
		return { published: undefined };
	}

	const text = await readTicketAsset({ settings, url: attachment.url });

	return typeof text === 'string'
		? readRecordText({ text, name, ticketRef })
		: { error: `the ${workOrderFileNames.record} on ${ticketRef} could not be read: ${text.error}` };
};
