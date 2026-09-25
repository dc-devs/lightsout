/**
 * The commit module's typed stop: a step that can fail returns
 * `T | CommitFailure` rather than throwing across a seam, exactly as
 * `QueueFailure` does for the queue and `ShipStepFailure` does for ship.
 */
export interface CommitFailure {
	/** One sentence a human can act on. Never a stack. */
	error: string;
}
