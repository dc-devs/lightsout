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
	title?: string;
	/**
	 * The ticket's web page. Set, with `title`, wherever the step that makes the
	 * entry has the ticket in hand; both are absent only for a parked worktree
	 * whose ticket the tracker no longer returns, and a reader then shows the
	 * identifier alone.
	 */
	url?: string;
	/**
	 * Why the ticket's tracker state could not be reconciled after its merge.
	 *
	 * Set only on a `settled` entry whose done write failed, mirroring
	 * `TicketRunOutcome.reconciliationFailure`. The same text stays folded into
	 * `reason`; this field lets a reader show the failure without parsing it.
	 */
	reconciliationFailure?: string;
	/**
	 * True when the entry is reported but nothing is waiting on a re-run — an
	 * already-merged ticket the drain reconciled to Done. Two steps produce one:
	 * `reconcileMergedTickets`, for a branch the forge or the queue's own record
	 * says has merged, and `settleMergedTrees`, for a parked worktree whose
	 * branch was already recorded merged.
	 *
	 * The drain's two "is there work left" questions — the exit code and the
	 * coordinator run's status — count only entries without it. A reconciled
	 * ticket is finished and will never be offered again, so counting it would
	 * make a fully shipped drain exit 2 and record an escalated run. Every other
	 * entry leaves it unset, deliberately: the parked scan's skip of a ticket
	 * the tracker files as finished whose branch never merged is the clearest
	 * case, because that worktree is still on disk and may hold work nobody has
	 * merged, so a person owes it a look.
	 */
	settled?: boolean;
}
