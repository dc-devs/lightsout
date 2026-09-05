import type { QueueDrainReport } from '#src/queue/common/types/QueueDrainReport.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { WaveSelection } from '#src/queue/common/types/WaveSelection.ts';
import type { LaneContext } from '#src/queue/drainLanes/common/types/LaneContext.ts';
import type { LaneFlight } from '#src/queue/drainLanes/common/types/LaneFlight.ts';
import type { LaneState } from '#src/queue/drainLanes/common/types/LaneState.ts';
import { admitScanned } from '#src/queue/drainLanes/common/utils/admitScanned.ts';
import { startBuilds } from '#src/queue/drainLanes/common/utils/startBuilds.ts';
import { startScan } from '#src/queue/drainLanes/common/utils/startScan.ts';
import { startShip } from '#src/queue/drainLanes/common/utils/startShip.ts';
import { writeQueuePlan } from '#src/queue/drainLanes/common/utils/writeQueuePlan.ts';

interface Params extends LaneContext {
	/** The opening selection, straight from the startup scan and not yet reconciled against already-merged branches. */
	first: WaveSelection;
	/** Outcomes settled before the drain began — the parked scan's. Ready ones enter the ship lane ahead of every branch built here. */
	carried: TicketRunOutcome[];
	/** Lower-cased identifiers the parked scan already settled, never offered to a builder. */
	attempted: Set<string>;
}

const seedState = ({ attempted, carried }: { attempted: Set<string>; carried: TicketRunOutcome[] }): LaneState => ({
	pending: [],
	queued: [],
	readyToShip: carried.filter((outcome) => outcome.ready),
	outcomes: carried.filter((outcome) => !outcome.ready),
	leftBehind: [],
	attempted: new Set(attempted),
	blockedByIdentifier: new Map(),
	retired: 0,
	rescanRequested: false,
	idleScanSpent: false,
	scansStopped: false,
});

/** Everything nothing ever ran, named rather than dropped: the tickets no slot reached, then whatever is still blocked. */
const finishDrain = ({ context, state }: { context: LaneContext; state: LaneState }): QueueDrainReport => {
	for (const ticket of state.pending) {
		const reason = 'not started: every slot was retired by a ticket parked on an unanswered question';

		state.leftBehind.push({ identifier: ticket.identifier, reason });
		context.onProgress?.(`${ticket.identifier} · ${reason}`);
	}

	state.leftBehind.push(...state.blockedByIdentifier.values());

	return { outcomes: state.outcomes, leftBehind: state.leftBehind };
};

/**
 * The drain: parallel builders and one serial ship lane, running at the same
 * time against the single `queue.max-parallel` budget.
 *
 * A branch merges the moment the lane reaches it rather than at the end of a
 * wave, and a freed slot goes to a waiting ready branch before it starts a build
 * that has not begun — without that priority a long backlog would starve the
 * lane, which is the exact wait this drain exists to remove. Each landed merge
 * makes the tracker worth re-reading, so the tickets it unblocked join the run
 * already in flight.
 *
 * The loop ends when nothing is in flight, which is also when no step could
 * start anything. `pending` is deliberately not part of that test: once every
 * builder slot is retired no build can start again, and what is left is reported
 * as never started. It terminates because `attempted` only grows, so only
 * finitely many scans can admit anything.
 */
export const runDrainLanes = async ({ first, carried, attempted, ...context }: Params): Promise<QueueDrainReport> => {
	const state = seedState({ attempted, carried });
	const flight: LaneFlight = { tasks: new Map(), builds: 0, ships: 0, scans: 0, nextKey: 0 };

	await admitScanned({ context, state, selection: first });
	await writeQueuePlan({ path: context.planPath, cwd: context.cwd, settings: context.settings, queued: state.queued });

	for (;;) {
		startShip({ context, state, flight });
		startBuilds({ context, state, flight });
		startScan({ context, state, flight });

		if (flight.tasks.size === 0) {
			break;
		}

		flight.tasks.delete(await Promise.race(flight.tasks.values()));
	}

	return finishDrain({ context, state });
};
