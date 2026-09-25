import { join } from 'node:path';
import type { QueueBoardTicket } from '#src/contracts/queue/QueueBoardTicket.ts';
import { QueueLane } from '#src/contracts/queue/QueueLane.ts';
import type { LiveQueueBoard } from '#src/queue/board/common/types/LiveQueueBoard.ts';
import type { BuildInFlight } from '#src/queue/common/types/BuildInFlight.ts';
import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';
import type { QueueDrainReport } from '#src/queue/common/types/QueueDrainReport.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WorkOrderRunOutcome } from '#src/queue/common/types/WorkOrderRunOutcome.ts';

interface Params {
	/** Outcomes and left-behind entries the drain has settled. With nothing else, this is the final board. */
	settled: QueueDrainReport;
	/** The lanes of a drain still running, and what the board recorder knows about them. */
	live?: LiveQueueBoard;
	/** ISO time of the snapshot: the entry time of every ticket that has just entered its lane. */
	at: string;
}

/** A ticket's place on the board before its lane-entry time is known. */
type Placed = Omit<QueueBoardTicket, 'enteredAt'>;

/**
 * Who the ticket is, the worker building it, and where that work lives.
 *
 * `workOrderName` is the work order's LABEL rather than its branch: a plan
 * address and a runs folder are both built from the label, and a prefixed
 * branch would name neither.
 */
const describeWork = ({ ticket, name, branch, worktreePath }: { ticket: TicketSummary; name: string; branch: string; worktreePath: string }) => ({
	identifier: ticket.identifier,
	title: ticket.title,
	url: ticket.url,
	worker: ticket.worker,
	workOrderName: name,
	branch,
	worktreePath,
});

/** A work order with no outcome yet, its branch and worktree read off the record rather than rendered from a template. */
const describeUnbuilt = ({ workOrder, live }: { workOrder: NamedWorkOrder; live: LiveQueueBoard }) =>
	describeWork({ ticket: workOrder.ticket, name: workOrder.name, branch: workOrder.branch, worktreePath: join(live.worktreesRoot, workOrder.name) });

const placeLeftBehind = ({ entry, lane, reason }: { entry: LeftBehindTicket; lane: QueueLane; reason: string | undefined }) => ({
	identifier: entry.identifier,
	title: entry.title,
	url: entry.url,
	lane,
	reason,
});

/** A build in flight, unless its worker is waiting for a relayed answer — then the question holds it in Blocked. */
const placeBuild = ({ build, live }: { build: BuildInFlight; live: LiveQueueBoard }) => {
	const question = live.questions.get(build.workOrder.ticket.identifier.toLowerCase());
	const work = { ...describeUnbuilt({ workOrder: build.workOrder, live }), buildStartedAt: build.startedAt };

	return question === undefined ? { ...work, lane: QueueLane.Building } : { ...work, lane: QueueLane.Blocked, reason: question, question };
};

/** A settled outcome's lane: shipped, blocked when the ticket was only left open, and parked otherwise. */
const placeOutcome = ({ outcome }: { outcome: WorkOrderRunOutcome }) => {
	let lane: QueueLane;
	let reason: string | undefined;

	if (outcome.ready) {
		lane = QueueLane.Shipped;
		reason = outcome.reconciliationFailure;
	} else if (outcome.open === undefined) {
		lane = QueueLane.Parked;
		reason = outcome.error;
	} else {
		// Blocked rather than Parked: that lane already holds the tickets waiting on a
		// human, which is what an open ticket is waiting on.
		lane = QueueLane.Blocked;
		reason = outcome.open;
	}

	return { ...describeWork(outcome), lane, reason };
};

const placeSettled = ({ settled }: { settled: QueueDrainReport }) => [
	...settled.outcomes.map((outcome) => placeOutcome({ outcome })),
	...settled.leftBehind.map((entry) =>
		entry.settled === true
			? placeLeftBehind({ entry, lane: QueueLane.Shipped, reason: entry.reconciliationFailure })
			: placeLeftBehind({ entry, lane: QueueLane.Blocked, reason: entry.reason }),
	),
];

/** The live lanes, in the order a record claims its ticket when two name the same one. */
const placeLive = ({ live }: { live: LiveQueueBoard }) => [
	...(live.shipping === undefined ? [] : [{ ...describeWork(live.shipping), lane: QueueLane.ShippingNow }]),
	...live.readyToShip.map((outcome) => ({ ...describeWork(outcome), lane: QueueLane.ShipQueue })),
	...live.building.map((build) => placeBuild({ build, live })),
	...live.pending.map((workOrder) => ({ ...describeUnbuilt({ workOrder, live }), lane: QueueLane.BuildQueue })),
	...live.blocked.map((entry) => placeLeftBehind({ entry, lane: QueueLane.Blocked, reason: entry.reason })),
];

/** A ticket still in the lane it was last recorded in keeps the time it entered it; any other has just entered. */
const toEnteredAt = ({ ticket, live, at }: { ticket: Placed; live: LiveQueueBoard | undefined; at: string }) => {
	const entered = live?.entered.get(ticket.identifier.toLowerCase());

	return entered !== undefined && entered.lane === ticket.lane ? entered.at : at;
};

/**
 * Every ticket a drain's records name, each in exactly one board lane.
 *
 * When two records name one ticket, the one that ranks higher places it:
 * settled outcome, settled left-behind entry, Shipping Now, Ship Queue, a build
 * in flight, Build Queue, then a still-held blocked entry. The list runs lane by
 * lane in `QueueLane` order, and each lane keeps its ledger's order.
 *
 * Pure: the caller reads the clock and passes it as `at`, so one snapshot's
 * board is the same however often it is drawn.
 */
export const toQueueBoardTickets = ({ settled, live, at }: Params): QueueBoardTicket[] => {
	const records: Placed[] = [...placeSettled({ settled }), ...(live === undefined ? [] : placeLive({ live }))];
	const claimed = new Map<string, Placed>();

	for (const record of records) {
		const key = record.identifier.toLowerCase();

		if (!claimed.has(key)) {
			claimed.set(key, record);
		}
	}

	const kept = [...claimed.values()];
	const inColumnOrder = Object.values(QueueLane).flatMap((lane) => {
		const inLane = kept.filter((ticket) => ticket.lane === lane);

		// Question waits close Blocked, after every entry held back without one.
		return [...inLane.filter((ticket) => ticket.question === undefined), ...inLane.filter((ticket) => ticket.question !== undefined)];
	});

	return inColumnOrder.map((ticket) => ({ ...ticket, enteredAt: toEnteredAt({ ticket, live, at }) }));
};
