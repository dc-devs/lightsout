import { messageOf } from '#src/common/utils/messageOf.ts';
import type { LaneContext } from '#src/queue/drainLanes/common/types/LaneContext.ts';
import type { LaneFlight } from '#src/queue/drainLanes/common/types/LaneFlight.ts';
import type { LaneState } from '#src/queue/drainLanes/common/types/LaneState.ts';
import { admitScanned } from '#src/queue/drainLanes/common/utils/admitScanned.ts';
import { trackTask } from '#src/queue/drainLanes/common/utils/trackTask.ts';
import { writeQueuePlan } from '#src/queue/drainLanes/common/utils/writeQueuePlan.ts';
import { listNextWave } from '#src/queue/listNextWave.ts';

interface Params {
	context: LaneContext;
	state: LaneState;
	flight: LaneFlight;
}

/** The tracker read itself, settling a refusal as the stop it should have returned rather than letting it reach the drain's race. */
const runScan = async ({ context, state }: { context: LaneContext; state: LaneState }) => {
	const { settings, trackerSettings, onProgress } = context;
	const scanned = listNextWave({ settings, trackerSettings, attempted: state.attempted, onProgress });
	const next = await scanned.catch((thrown: unknown) => ({ error: messageOf({ error: thrown }) }));

	if ('error' in next) {
		state.scansStopped = true;
		onProgress?.(`the re-scan for newly unblocked tickets failed, so nothing new will join this run: ${next.error}`);
	} else {
		const admitted = await admitScanned({ context, state, selection: next });

		if (admitted.length > 0) {
			onProgress?.(`${admitted.map((ticket) => ticket.identifier).join(', ')} · joined the run already in flight`);
			await writeQueuePlan({ path: context.planPath, cwd: context.cwd, settings, queued: state.queued });
		}
	}
};

/**
 * The tracker re-read a landed merge makes worth making, in its own task: not a
 * gate run, so it holds no slot, and never on the ship lane, so a merge never
 * waits on the network. One scan at a time, so two can never race the ledger.
 *
 * It runs only while something is held back as blocked — a merge can unblock a
 * ticket only if one was — so a drain with nothing blocked reads the tracker
 * exactly once, as it always did. `idleScanSpent` stops it re-reading an
 * unchanged tracker: set when a scan starts, handed back by a merge that landed
 * or a scan that admitted tickets.
 */
export const startScan = ({ context, state, flight }: Params): void => {
	const allowed = flight.scans === 0 && !state.scansStopped && state.blockedByIdentifier.size > 0 && state.retired < context.settings.maxParallel;
	const idle = flight.tasks.size === 0 && state.pending.length === 0 && state.readyToShip.length === 0 && !state.idleScanSpent;

	if (allowed && (state.rescanRequested || idle)) {
		state.rescanRequested = false;
		state.idleScanSpent = true;
		flight.scans += 1;
		trackTask({
			flight,
			run: async () => {
				await runScan({ context, state });
				flight.scans -= 1;
			},
		});
	}
};
