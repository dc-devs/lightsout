import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';

/** The tracker a work order's state publishes to, and the ticket its folder name names. */
export interface TicketTrackerTarget {
	settings: TrackerSettings;
	/** The ticket reference the work order's label carries, e.g. 'lo-140'. */
	ticketRef: string;
}
