import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';
import type { LaneContext } from '#src/queue/drainLanes/internal/common/types/LaneContext.ts';
import type { LaneState } from '#src/queue/drainLanes/internal/common/types/LaneState.ts';
import { admitSelection } from '#src/queue/drainLanes/internal/common/utils/admitSelection.ts';
import { settleMergedSelection } from '#src/queue/drainLanes/internal/common/utils/settleMergedSelection.ts';
import type { WaveSelection } from '#src/queue/internal/common/types/WaveSelection.ts';
import { nameWaveWorkOrders } from '#src/queue/nameWaveWorkOrders.ts';

interface Params {
	context: LaneContext;
	state: LaneState;
	selection: WaveSelection;
}

/**
 * One scan's selection named, reconciled against already-merged branches and
 * then folded into the ledger — the one path the opening selection and every
 * re-scan both take.
 *
 * The order is a requirement rather than a preference: the merge check reads
 * each work order's stored branch, so a wave that has not been named has
 * nothing to check. What the naming step left behind joins this scan's settled
 * skips, which is what marks those tickets attempted so no later scan offers
 * them again.
 *
 * @returns the work orders that joined the run, in admission order
 */
export const admitScanned = async ({ context, state, selection }: Params): Promise<NamedWorkOrder[]> => {
	const { cwd, config, env, driver, serializeMainCheckout, onProgress } = context;
	const wave = await nameWaveWorkOrders({ cwd, config, env, driver, tickets: selection.runnable, onProgress });
	const settled = await settleMergedSelection({
		cwd,
		config,
		env,
		workOrders: wave.named,
		skipped: [...selection.skipped, ...wave.leftBehind],
		serializeMainCheckout,
		onProgress,
	});
	const admitted = admitSelection({ state, workOrders: settled.workOrders, blocked: selection.blocked, skipped: settled.skipped });

	if (admitted.length > 0) {
		// What just joined makes the tracker worth another look once it finishes.
		state.idleScanSpent = false;
	}

	return admitted;
};
