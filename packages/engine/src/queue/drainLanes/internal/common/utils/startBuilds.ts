import { messageOf } from '#src/common/utils/messageOf.ts';
import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';
import type { WorkOrderRunOutcome } from '#src/queue/common/types/WorkOrderRunOutcome.ts';
import type { LaneContext } from '#src/queue/drainLanes/internal/common/types/LaneContext.ts';
import type { LaneFlight } from '#src/queue/drainLanes/internal/common/types/LaneFlight.ts';
import type { LaneState } from '#src/queue/drainLanes/internal/common/types/LaneState.ts';
import { trackTask } from '#src/queue/drainLanes/internal/common/utils/trackTask.ts';
import { resolveWorktreePath } from '#src/worktree/resolveWorktreePath.ts';

interface Params {
	context: LaneContext;
	state: LaneState;
	flight: LaneFlight;
}

/** A build that threw: parked carrying the message, and never `unanswered` — a crash holds no human, so its slot refills. */
const parkedBuild = async ({
	context,
	workOrder,
	thrown,
}: {
	context: LaneContext;
	workOrder: NamedWorkOrder;
	thrown: unknown;
}): Promise<WorkOrderRunOutcome> => {
	const { ticket, name, branch } = workOrder;
	const worktreePath = await resolveWorktreePath({ cwd: context.cwd, branch });

	return { ticket, name, branch, worktreePath, ready: false, error: messageOf({ error: thrown }) };
};

/** The build leaves `building` in the same step its outcome joins a lane, so no snapshot shows it in two or in none. */
const settleBuild = ({ state, workOrder, outcome }: { state: LaneState; workOrder: NamedWorkOrder; outcome: WorkOrderRunOutcome }) => {
	state.building.delete(workOrder.ticket.identifier.toLowerCase());

	if (outcome.unanswered === true) {
		state.retired += 1;
	}

	if (outcome.ready) {
		state.readyToShip.push(outcome);
	} else {
		state.outcomes.push(outcome);
	}
};

/** One work order built and settled — never rejecting, for the reason the ship lane never does. */
const buildWorkOrder = async ({ context, state, workOrder }: { context: LaneContext; state: LaneState; workOrder: NamedWorkOrder }) => {
	try {
		settleBuild({ state, workOrder, outcome: await context.runWorkOrder({ workOrder }) });
	} catch (thrown) {
		settleBuild({ state, workOrder, outcome: await parkedBuild({ context, workOrder, thrown }) });
	}
};

/**
 * Fill every builder slot the ship lane and the retired questions have left.
 *
 * A slot whose ticket parked on an unanswered question is retired rather than
 * refilled: an unanswered question means the human is away, and a drain that
 * refilled would pile up questions nobody is reading. A plain failure holds no
 * human and blocks nothing, so it frees its slot.
 */
export const startBuilds = ({ context, state, flight }: Params): void => {
	while (state.pending.length > 0 && flight.builds + flight.ships + state.retired < context.settings.maxParallel) {
		const workOrder = state.pending.shift();

		if (workOrder === undefined) {
			break;
		}

		flight.builds += 1;
		state.building.set(workOrder.ticket.identifier.toLowerCase(), { workOrder, startedAt: new Date().toISOString() });
		trackTask({
			flight,
			run: async () => {
				await buildWorkOrder({ context, state, workOrder });
				flight.builds -= 1;
			},
		});
	}
};
