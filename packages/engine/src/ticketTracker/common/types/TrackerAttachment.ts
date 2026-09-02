/**
 * One attachment on a ticket, reduced to what a caller of this module actually
 * uses.
 *
 * Declared here rather than letting a tracker's own attachment class leak
 * upward, for the reason `TrackerTicket` exists: nothing above the seam sees a
 * tracker's types, so swapping trackers stays a change inside this folder.
 */
export interface TrackerAttachment {
	/** The tracker's own id for the attachment — what a delete keys on. */
	id: string;
	/** The attachment's title. Publish writes the durable file's own name here, and the fetch matches on it. */
	title: string;
	/** The permanent asset URL the bytes are read from. */
	url: string;
}
