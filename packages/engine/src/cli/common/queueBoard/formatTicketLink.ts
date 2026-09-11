import { toInlineMarkdown } from '#src/cli/common/queueBoard/toInlineMarkdown.ts';
import type { QueueBoardTicket } from '#src/contracts/index.ts';

interface Params {
	ticket: Pick<QueueBoardTicket, 'identifier' | 'title' | 'url'>;
}

/**
 * One ticket's label, as a board cell and a detail block's heading show it:
 * `ID · Title`, linked to the ticket when the board recorded a link. With no
 * title it is the identifier alone, and with no link it is left unlinked.
 */
export const formatTicketLink = ({ ticket }: Params): string => {
	const title = ticket.title === undefined ? '' : toInlineMarkdown({ text: ticket.title });
	const label = title === '' ? ticket.identifier : `${ticket.identifier} · ${title}`;

	return ticket.url === undefined || ticket.url === '' ? label : `[${label}](${ticket.url})`;
};
