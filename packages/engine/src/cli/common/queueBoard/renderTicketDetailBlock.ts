import { formatTicketLink } from '#src/cli/common/queueBoard/formatTicketLink.ts';
import { toInlineMarkdown } from '#src/cli/common/queueBoard/toInlineMarkdown.ts';
import type { QueueBoardTicket } from '#src/contracts/index.ts';

interface Params {
	ticket: QueueBoardTicket;
	/** The status command's own lines for this ticket, emitted exactly as given. */
	lines: string[];
}

/**
 * One active ticket's detail block: a blank line, the ticket's label in bold, a
 * blank line, then a `text` fence around its status lines.
 *
 * A ticket waiting for a relayed answer says so in the heading, with the whole
 * question on one line — outside the fence, because nothing inside it may
 * differ from what the standalone status command prints.
 */
export const renderTicketDetailBlock = ({ ticket, lines }: Params): string[] => {
	const waiting = ticket.question === undefined ? '' : ` — waiting for an answer: ${toInlineMarkdown({ text: ticket.question })}`;

	return ['', `**${formatTicketLink({ ticket })}**${waiting}`, '', '```text', ...lines, '```'];
};
