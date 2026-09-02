/**
 * What the tracker seam needs to make one call: which team, and the key to make
 * it with.
 *
 * Deliberately smaller than `QueueSettings`: an operation that took the whole
 * queue block could read a queue policy off it, and a module promoted out of
 * the queue must not be able to.
 */
export interface TrackerSettings {
	/** The tracker's team key, e.g. 'LO'. */
	team: string;
	/** The key itself, read from the configured environment variable. Never logged. */
	apiKey: string;
}
