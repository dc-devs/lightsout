import { readTicketMatch } from '#src/ship/index.ts';

interface Params {
	/** Kebab plan name — the plan folder's own name, not a path. */
	name: string;
	/** `ShipSettings.ticketPattern` — the same compiled pattern branch names are read with. */
	ticketPattern: RegExp;
}

/**
 * The ticket a plan folder's name carries, or undefined when it carries none.
 *
 * A plan folder is named after its branch, so the ticket id is read off it with
 * the repo's own `ship.ticket-pattern` and no second pattern is ever declared —
 * a plan-folder key of its own would let the two formats drift apart. Naming
 * the rule here is what keeps it findable from the plan side; forwarding to
 * `readTicketMatch` is what keeps the regular expression spelled once.
 *
 * A name that merely looks like a ticket id is read as one: `phase-2-cleanup`
 * yields `phase-2` against the default pattern. That is the identical false
 * positive the branch reader has always carried against the identical pattern,
 * and guarding against it here would be a second rule about what a ticket id
 * looks like — the drift this reader exists to prevent.
 */
export const readPlanTicketRef = ({ name, ticketPattern }: Params): string | undefined => readTicketMatch({ branch: name, ticketPattern })?.ticket;
