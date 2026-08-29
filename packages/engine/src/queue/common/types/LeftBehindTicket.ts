/**
 * A ticket the drain touched and deliberately did not run, and why.
 *
 * It never became a `TicketRunOutcome` — nothing ran it — so it is carried
 * beside the outcomes instead, which is what keeps a ticket from vanishing
 * from the queue's final summary.
 */
export interface LeftBehindTicket {
	identifier: string;
	reason: string;
}
