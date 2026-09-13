import { ticketFolderOf } from '#src/common/planAddress/ticketFolderOf.ts';
import { readTicketMatch } from '#src/ship/index.ts';

interface Params {
	/** A plan address, or a legacy plan folder's own name — never a path. */
	name: string;
	/** `ShipSettings.ticketPattern` — the same compiled pattern branch names are read with. */
	ticketPattern: RegExp;
}

/**
 * The ticket a plan's name carries, or undefined when it carries none.
 *
 * The id is read off the ticket-branch segment: a ticket folder is named after
 * its branch, and every plan inside it belongs to that one ticket, so matching
 * the whole address would answer nothing for a pattern anchored to the end of a
 * branch name. A legacy name is its own ticket folder and reads unchanged.
 *
 * The match uses the repo's own `ship.ticket-pattern`, and no second pattern is
 * ever declared — a plan-folder key of its own would let the two formats drift
 * apart. Naming the rule here is what keeps it findable from the plan side;
 * forwarding to `readTicketMatch` is what keeps the regular expression spelled
 * once.
 *
 * A name that merely looks like a ticket id is read as one: `phase-2-cleanup`
 * yields `phase-2` against the default pattern. That is the identical false
 * positive the branch reader has always carried against the identical pattern,
 * and guarding against it here would be a second rule about what a ticket id
 * looks like — the drift this reader exists to prevent.
 */
export const readPlanTicketRef = ({ name, ticketPattern }: Params): string | undefined =>
	readTicketMatch({ branch: ticketFolderOf({ name }), ticketPattern })?.ticket;
