/**
 * The queue's typed stop: every step that can fail returns `T | QueueFailure`
 * rather than throwing across a seam, exactly as `ShipStepFailure` does for
 * ship.
 */
export interface QueueFailure {
	/** One sentence a human can act on. Never a stack. */
	error: string;
}
