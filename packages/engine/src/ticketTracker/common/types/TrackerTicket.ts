/**
 * One tracker issue, reduced to what a caller of this module actually uses.
 *
 * Nothing outside this module ever sees a tracker's own type, which is what
 * keeps swapping trackers a change inside this folder alone.
 *
 * There is no `route` field: routing is the queue's vocabulary, and this module
 * reports the labels it saw so the queue can decide what they mean.
 */
export interface TrackerTicket {
	/** The tracker's internal id — what every write call takes. */
	id: string;
	/** The human reference, e.g. 'LO-70'. */
	identifier: string;
	title: string;
	/** The ticket body as markdown. Empty string when the ticket has none. */
	description: string;
	/** Linear's priority scale: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
	priority: number;
	/** ISO timestamp — the tiebreak within a priority. */
	createdAt: string;
	/** Every label name the issue carries, in the order the tracker answered them. */
	labels: string[];
	/**
	 * Identifiers of blocking tickets that are not finished — empty when nothing
	 * blocks this one.
	 *
	 * The seam reports what it saw; the caller is the one place a skip policy
	 * lives.
	 */
	unfinishedBlockers: string[];
}
