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
	/**
	 * True when the entry is reported but nothing is waiting on a re-run — an
	 * already-merged ticket the drain reconciled to Done.
	 *
	 * The drain's two "is there work left" questions — the exit code and the
	 * coordinator run's status — count only entries without it. A reconciled
	 * ticket is finished and will never be offered again, so counting it would
	 * make a fully shipped drain exit 2 and record an escalated run. Every other
	 * entry leaves it unset.
	 */
	settled?: boolean;
}
