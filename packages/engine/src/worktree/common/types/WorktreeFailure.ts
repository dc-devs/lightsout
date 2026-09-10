/**
 * This module's typed stop: every step that can fail answers `T |
 * WorktreeFailure` rather than throwing across a seam, exactly as
 * `QueueFailure` does for the queue.
 *
 * Declared here rather than imported from the queue: the queue depends on this
 * module, and the reverse import would be a cycle.
 */
export interface WorktreeFailure {
	/** One sentence a human can act on. Never a stack. */
	error: string;
}
