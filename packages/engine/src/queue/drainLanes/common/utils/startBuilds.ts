import { join } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import { getWorktreesRoot } from '#src/queue/common/utils/getWorktreesRoot.ts';
import type { LaneContext } from '#src/queue/drainLanes/common/types/LaneContext.ts';
import type { LaneFlight } from '#src/queue/drainLanes/common/types/LaneFlight.ts';
import type { LaneState } from '#src/queue/drainLanes/common/types/LaneState.ts';
import { trackTask } from '#src/queue/drainLanes/common/utils/trackTask.ts';
import { toTicketBranch } from '#src/queue/toTicketBranch.ts';

interface Params {
	context: LaneContext;
	state: LaneState;
	flight: LaneFlight;
}

/** A build that threw: parked carrying the message, and never `unanswered` — a crash holds no human, so its slot refills. */
const parkedBuild = ({ context, ticket, thrown }: { context: LaneContext; ticket: RunnableTicket; thrown: unknown }): TicketRunOutcome => {
	const branch = toTicketBranch({ ticket, template: context.settings.branchTemplate });
	const worktreePath = join(getWorktreesRoot({ cwd: context.cwd }), branch);

	return { ticket, branch, worktreePath, ready: false, error: messageOf({ error: thrown }) };
};

const settleBuild = ({ state, outcome }: { state: LaneState; outcome: TicketRunOutcome }) => {
	if (outcome.unanswered === true) {
		state.retired += 1;
	}

	if (outcome.ready) {
		state.readyToShip.push(outcome);
	} else {
		state.outcomes.push(outcome);
	}
};

/** One ticket built and settled — never rejecting, for the reason the ship lane never does. */
const buildTicket = async ({ context, state, ticket }: { context: LaneContext; state: LaneState; ticket: RunnableTicket }) => {
	try {
		settleBuild({ state, outcome: await context.runTicket({ ticket }) });
	} catch (thrown) {
		settleBuild({ state, outcome: parkedBuild({ context, ticket, thrown }) });
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
		const ticket = state.pending.shift();

		if (ticket === undefined) {
			break;
		}

		flight.builds += 1;
		trackTask({
			flight,
			run: async () => {
				await buildTicket({ context, state, ticket });
				flight.builds -= 1;
			},
		});
	}
};
