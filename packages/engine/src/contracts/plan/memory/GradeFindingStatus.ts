/**
 * The lifecycle state of one memory record — what a finding is now, across every
 * pass that has seen it, rather than how one judge ruled on it once.
 *
 * `GapOutcome` is the judge's ruling on a single pass and is never rewritten;
 * this is what the record does with that ruling as the plan changes underneath
 * it. Only `Open` blocks.
 */
export const GradeFindingStatus = {
	/** A `needs-a-human` finding nobody has verified as answered yet. Blocks. */
	Open: 'open',
	/** An open record a re-verification judge closed by citing where the plan now states the answer. */
	Resolved: 'resolved',
	/** A finding a judge ruled the implementing agent can settle, or showed was already answered. Closed on creation. */
	Noted: 'noted',
} as const;

export type GradeFindingStatus = (typeof GradeFindingStatus)[keyof typeof GradeFindingStatus];
