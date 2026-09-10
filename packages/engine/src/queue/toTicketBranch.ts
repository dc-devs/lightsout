import { renderBranchTemplate } from '#src/common/utils/renderBranchTemplate.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';

interface Params {
	ticket: TicketSummary;
	/** `QueueSettings.branchTemplate` — `{ticket}` and `{slug}` tokens. */
	template: string;
}

/**
 * One tracker ticket's branch — the queue's five branch call sites read it here
 * rather than each reaching into a `TicketSummary` for the two fields the
 * shared renderer wants.
 *
 * The plan folder carries the branch's name and joins the same chain, which is
 * why `ship.ticket-pattern` reads a folder name exactly as it reads a branch
 * name. Linear's own `issue.branchName` is deliberately not used: it carries a
 * per-user prefix that `ship.ticket-pattern` would not match.
 */
export const toTicketBranch = ({ ticket, template }: Params): string => renderBranchTemplate({ template, ticketRef: ticket.identifier, title: ticket.title });
