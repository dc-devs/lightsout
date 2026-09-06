import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { WaveSelection } from '#src/queue/common/types/WaveSelection.ts';
import { reconcileMergedTickets } from '#src/queue/reconcileMergedTickets.ts';

interface Params {
	/** The main repository checkout. */
	cwd: string;
	config: LightsoutConfig;
	/** The process environment the tracker credentials are read from. */
	env: NodeJS.ProcessEnv;
	settings: QueueSettings;
	selection: WaveSelection;
	/** Runs a task with no other main-checkout git mutation in flight. Reconciling a merged ticket removes its worktree from the main checkout. */
	serializeMainCheckout: <Result>(params: { task: () => Promise<Result> }) => Promise<Result>;
	onProgress?: (message: string) => void;
}

/**
 * The selection a scan may actually admit: the tickets whose branches have not
 * already merged, with the reconciled ones moved into this scan's settled skips.
 *
 * They join the skips rather than sitting beside them because that is what marks
 * them attempted — no later scan offers work that already shipped — and it is
 * the one path every other settled ticket reaches the report by.
 *
 * The reconciliation takes the shared chain: it removes a worktree from the main
 * checkout, and a builder may be adding one there at the same time.
 */
export const settleMergedSelection = async ({ cwd, config, env, settings, selection, serializeMainCheckout, onProgress }: Params): Promise<WaveSelection> => {
	const reconciled = await serializeMainCheckout({
		task: () => reconcileMergedTickets({ cwd, config, env, settings, tickets: selection.runnable, onProgress }),
	});

	return { ...selection, runnable: reconciled.kept, skipped: [...selection.skipped, ...reconciled.leftBehind] };
};
