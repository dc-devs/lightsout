import type { TrackerSettings } from '#src/ticketTracker/index.ts';

/** The tracker a ticket's record publishes to, and the ticket its folder name names. */
export interface TicketTrackerTarget {
	settings: TrackerSettings;
	/** The ticket reference the ticket folder's name carries, e.g. 'lo-140'. */
	ticketRef: string;
}
