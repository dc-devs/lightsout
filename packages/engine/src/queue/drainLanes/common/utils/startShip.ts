import { messageOf } from '#src/common/utils/messageOf.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { LaneContext } from '#src/queue/drainLanes/common/types/LaneContext.ts';
import type { LaneFlight } from '#src/queue/drainLanes/common/types/LaneFlight.ts';
import type { LaneState } from '#src/queue/drainLanes/common/types/LaneState.ts';
import { trackTask } from '#src/queue/drainLanes/common/utils/trackTask.ts';
import { shipOneBranch } from '#src/queue/shipOneBranch.ts';

interface Params {
	context: LaneContext;
	state: LaneState;
	flight: LaneFlight;
}

/** One branch merged and settled — never rejecting, because a rejection reaching the drain's race would abandon every branch still waiting. */
const mergeBranch = async ({ context, state, outcome }: { context: LaneContext; state: LaneState; outcome: TicketRunOutcome }) => {
	try {
		const shipped = await shipOneBranch({
			cwd: context.cwd,
			config: context.config,
			shipSettings: context.shipSettings,
			defaultBranch: context.defaultBranch,
			env: context.env,
			outcome,
			serializeMainCheckout: context.serializeMainCheckout,
			onProgress: context.onProgress,
		});

		state.outcomes.push(shipped);

		if (shipped.ready) {
			// The merge landed, so a blocker may have just finished.
			state.rescanRequested = true;
			state.idleScanSpent = false;
		}
	} catch (thrown) {
		// Settled the way the merge's own park path does: worktree intact, and no
		// re-scan, because nothing landed.
		state.outcomes.push({ ...outcome, ready: false, error: messageOf({ error: thrown }) });
	}
};

/**
 * The serial ship lane: the oldest waiting ready branch, merged now rather than
 * at the end of a wave.
 *
 * It tests the BUILDS in flight and not the retired slots, so a budget every
 * builder has been retired from still merges what is already finished — a merge
 * asks nobody a question. Run before the builders, so a slot that frees goes to
 * a branch already waiting rather than to a build that has not started.
 */
export const startShip = ({ context, state, flight }: Params): void => {
	const waiting = flight.ships > 0 || flight.builds >= context.settings.maxParallel ? undefined : state.readyToShip.shift();

	if (waiting !== undefined) {
		flight.ships += 1;
		trackTask({
			flight,
			run: async () => {
				await mergeBranch({ context, state, outcome: waiting });
				flight.ships -= 1;
			},
		});
	}
};
