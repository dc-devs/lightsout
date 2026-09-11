import type { BuildInFlight } from '#src/queue/common/types/BuildInFlight.ts';
import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';

/** The mutable ledger the drain's two lanes and the tracker re-scan all read and write. */
export interface LaneState {
	/** Admitted tickets no builder has picked up yet, in the order they will be. */
	pending: RunnableTicket[];
	/** Every ticket admitted so far, in admission order — what the coordinator's queue document lists. */
	queued: RunnableTicket[];
	/** Builds in flight, keyed by lower-cased identifier, in start order. A build leaves in the step that settles its outcome. */
	building: Map<string, BuildInFlight>;
	/** Branches finished and waiting for the ship lane, oldest-ready first. */
	readyToShip: TicketRunOutcome[];
	/** The branch the ship lane now holds, until its merge settles. */
	shipping: TicketRunOutcome | undefined;
	/** Settled outcomes: parked builds, and every branch the ship lane has finished with. */
	outcomes: TicketRunOutcome[];
	/** Tickets nothing ran, settled for good. */
	leftBehind: LeftBehindTicket[];
	/** Lower-cased identifiers already offered to a builder or settled — never admitted twice. */
	attempted: Set<string>;
	/** Every ticket ever held back as blocked, keyed by lower-cased identifier. An entry leaves only by being admitted or settled. */
	blockedByIdentifier: Map<string, LeftBehindTicket>;
	/** Builder slots retired by a ticket parked on an unanswered question. Never refilled, and never withheld from the ship lane. */
	retired: number;
	/** A merge has landed since the last scan started, so the tracker is worth re-reading. */
	rescanRequested: boolean;
	/** A scan has already read the tracker and nothing has changed since — no merge landed, and no scan admitted anything. */
	idleScanSpent: boolean;
	/** A scan failed, so no further one is started — the drain still finishes what it holds. */
	scansStopped: boolean;
}
