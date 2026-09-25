import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';
import type { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';

/**
 * One wave entry whose name is already settled, with the same label and branch
 * `queueOutcomeFixture` reports back — so a lane test can push an entry and
 * compare the outcome it produces without restating either string.
 */
export const namedWorkOrderFixture = ({
	ticket,
	name = `${ticket.identifier.toLowerCase()}-ticket-${ticket.id}`,
	branch = name,
}: {
	ticket: ReturnType<typeof queueTicketFixture>;
	name?: string;
	branch?: string;
}): NamedWorkOrder => ({ ticket, name, branch });
