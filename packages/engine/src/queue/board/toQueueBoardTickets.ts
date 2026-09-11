import { join } from 'node:path';
import { type QueueBoardTicket, QueueLane } from '#src/contracts/index.ts';
import type { LiveQueueBoard } from '#src/queue/board/common/types/LiveQueueBoard.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { BuildInFlight } from '#src/queue/common/types/BuildInFlight.ts';
import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { QueueDrainReport } from '#src/queue/common/types/QueueDrainReport.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { toTicketBranch } from '#src/queue/toTicketBranch.ts';

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

/** Who the ticket is, the worker building it, and where that work lives. */
const describeWork = ({ ticket, branch, worktreePath }: { ticket: TicketSummary; branch: string; worktreePath: string }) => ({
	identifier: ticket.identifier,
	title: ticket.title,
	url: ticket.url,
	worker: ticket.worker,
	planName: ticket.worker === QueueWorker.AutoPlan ? branch : undefined,
	branch,
	worktreePath,
});

/** A ticket with no outcome yet, its branch and worktree derived the way the queue's document derives them. */
const describeUnbuilt = ({ ticket, live }: { ticket: TicketSummary; live: LiveQueueBoard }) => {
	const branch = toTicketBranch({ ticket, template: live.branchTemplate });

	return describeWork({ ticket, branch, worktreePath: join(live.worktreesRoot, branch) });
};

const placeLeftBehind = ({ entry, lane, reason }: { entry: LeftBehindTicket; lane: QueueLane; reason: string | undefined }) => ({
	identifier: entry.identifier,
	title: entry.title,
	url: entry.url,
	lane,
	reason,
});

/** A build in flight, unless its worker is waiting for a relayed answer — then the question holds it in Blocked. */
const placeBuild = ({ build, live }: { build: BuildInFlight; live: LiveQueueBoard }) => {
	const question = live.questions.get(build.ticket.identifier.toLowerCase());
	const work = { ...describeUnbuilt({ ticket: build.ticket, live }), buildStartedAt: build.startedAt };

	return question === undefined ? { ...work, lane: QueueLane.Building } : { ...work, lane: QueueLane.Blocked, reason: question, question };
};

const placeSettled = ({ settled }: { settled: QueueDrainReport }) => [
	...settled.outcomes.map((outcome) =>
		outcome.ready
			? { ...describeWork(outcome), lane: QueueLane.Shipped, reason: outcome.reconciliationFailure }
			: { ...describeWork(outcome), lane: QueueLane.Parked, reason: outcome.error },
	),
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
	...live.pending.map((ticket) => ({ ...describeUnbuilt({ ticket, live }), lane: QueueLane.BuildQueue })),
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
