/**
 * One tracker issue, reduced to what a caller of this module actually uses.
 *
 * Nothing outside this module ever sees a tracker's own type, which is what
 * keeps swapping trackers a change inside this folder alone.
 *
 * There is no `route` field: routing is the queue's vocabulary, and this module
 * reports the labels it saw so the queue can decide what they mean. `status` is
 * here for the opposite reason — it is the tracker's own word for where the
 * ticket sits in its workflow, so reporting it is reporting what was seen,
 * while any classification derived from it stays the caller's.
 */
export interface TrackerTicket {
	/** The tracker's internal id — what every write call takes. */
	id: string;
	/** The human reference, e.g. 'LO-70'. */
	identifier: string;
	title: string;
	/** The ticket body as markdown. Empty string when the ticket has none. */
	description: string;
	/** Provider-normalized priority, with smaller positive numbers sorting first and zero meaning unspecified. */
	priority: number;
	/** ISO timestamp — the tiebreak within a priority. */
	createdAt: string;
	/** Every label name the issue carries, in the order the tracker answered them. */
	labels: string[];
	/**
	 * The tracker's own workflow status name, exactly as the tracker spells it —
	 * 'Backlog', 'Ready to implement', 'In Progress', 'Done'.
	 *
	 * The seam reports the name and nothing more. Which statuses mean a ticket may
	 * be worked, and which pair of status and label makes it selectable, is the
	 * caller's vocabulary, not this module's.
	 */
	status: string;
	/**
	 * Identifiers of blocking tickets that are not finished — empty when nothing
	 * blocks this one.
	 *
	 * The seam reports what it saw; the caller is the one place a skip policy
	 * lives.
	 */
	unfinishedBlockers: string[];
}
