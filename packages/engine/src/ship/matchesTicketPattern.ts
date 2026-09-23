import { readTicketMatch } from '#src/ship/readTicketMatch.ts';

interface Params {
	branch: string;
	/** `ShipSettings.ticketPattern` — the repository's own branch-and-ticket convention. */
	ticketPattern: RegExp;
}

/**
 * Whether a branch carries a ticket the repository's own `ship.ticket-pattern`
 * reads — ship's public answer to "would this branch be shippable?".
 *
 * It narrows rather than forwards. `readTicketMatch` answers the capture groups
 * a pull request body substitutes from, and handing those across ship's
 * boundary is how a name came to have several authors; a boolean is the whole
 * of what a caller outside ship may legitimately ask.
 */
export const matchesTicketPattern = ({ branch, ticketPattern }: Params): boolean => readTicketMatch({ branch, ticketPattern }) !== undefined;
