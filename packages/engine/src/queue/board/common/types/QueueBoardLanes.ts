import type { BuildInFlight } from '#src/queue/common/types/BuildInFlight.ts';
import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';

/**
 * The in-flight lanes the drain hands the board recorder on each pass. Settled
 * outcomes and left-behind entries travel beside it, as a `QueueDrainReport`.
 */
export interface QueueBoardLanes {
	/** Admitted, no builder yet, in pick-up order. */
	pending: RunnableTicket[];
	/** Builds in flight, in start order. */
	building: BuildInFlight[];
	/** Built and waiting for the ship lane, oldest-ready first. */
	readyToShip: TicketRunOutcome[];
	/** The branch the ship lane now holds. */
	shipping: TicketRunOutcome | undefined;
	/** Held back by an unfinished blocker or a gate hold, and not yet settled, in first-held order. */
	blocked: LeftBehindTicket[];
}
