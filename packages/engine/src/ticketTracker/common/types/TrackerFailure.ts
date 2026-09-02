/**
 * The tracker seam's typed stop: every operation returns `T | TrackerFailure`
 * rather than throwing across the seam, exactly as `QueueFailure` does for the
 * queue and `ShipStepFailure` does for ship.
 *
 * Declared here rather than imported from the queue because a module promoted
 * out of the queue cannot import the queue's types. The two shapes are
 * identical, so a queue caller that returns what this seam handed it keeps
 * compiling unchanged.
 */
export interface TrackerFailure {
	/** One sentence a human can act on. Never a stack. */
	error: string;
}
