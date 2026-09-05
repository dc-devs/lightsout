import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { WaveSelection } from '#src/queue/common/types/WaveSelection.ts';
import type { LaneContext } from '#src/queue/drainLanes/common/types/LaneContext.ts';
import type { LaneState } from '#src/queue/drainLanes/common/types/LaneState.ts';
import { admitSelection } from '#src/queue/drainLanes/common/utils/admitSelection.ts';
import { settleMergedSelection } from '#src/queue/drainLanes/common/utils/settleMergedSelection.ts';

interface Params {
	context: LaneContext;
	state: LaneState;
	selection: WaveSelection;
}

/**
 * One scan's selection reconciled against already-merged branches and then
 * folded into the ledger — the one path the opening selection and every re-scan
 * both take.
 *
 * @returns the tickets that joined the run, in admission order
 */
export const admitScanned = async ({ context, state, selection }: Params): Promise<RunnableTicket[]> => {
	const { cwd, config, env, settings, serializeMainCheckout, onProgress } = context;
	const settled = await settleMergedSelection({ cwd, config, env, settings, selection, serializeMainCheckout, onProgress });
	const admitted = admitSelection({ state, selection: settled });

	if (admitted.length > 0) {
		// What just joined makes the tracker worth another look once it finishes.
		state.idleScanSpent = false;
	}

	return admitted;
};
