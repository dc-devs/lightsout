import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';
import type { LeftBehindTicket } from '#src/queue/internal/common/types/LeftBehindTicket.ts';
import { reconcileMergedTickets } from '#src/queue/ticketSelection/reconcileMergedTickets.ts';

interface Params {
	/** The main repository checkout. */
	cwd: string;
	config: LightsoutConfig;
	/** The process environment the tracker credentials are read from. */
	env: NodeJS.ProcessEnv;
	/** The wave's named work orders, and the entries the scan has already settled. */
	workOrders: NamedWorkOrder[];
	skipped: LeftBehindTicket[];
	/** Runs a task with no other main-checkout git mutation in flight. Reconciling a merged ticket removes its worktree from the main checkout. */
	serializeMainCheckout: <Result>(params: { task: () => Promise<Result> }) => Promise<Result>;
	onProgress?: (message: string) => void;
}

/**
 * The work orders a scan may actually admit: the ones whose stored branches
 * have not already merged, with the reconciled ones moved into this scan's
 * settled skips.
 *
 * They join the skips rather than sitting beside them because that is what marks
 * them attempted — no later scan offers work that already shipped — and it is
 * the one path every other settled ticket reaches the report by.
 *
 * The reconciliation takes the shared chain: it removes a worktree from the main
 * checkout, and a builder may be adding one there at the same time.
 */
export const settleMergedSelection = async ({
	cwd,
	config,
	env,
	workOrders,
	skipped,
	serializeMainCheckout,
	onProgress,
}: Params): Promise<{ workOrders: NamedWorkOrder[]; skipped: LeftBehindTicket[] }> => {
	const reconciled = await serializeMainCheckout({
		task: () => reconcileMergedTickets({ cwd, config, env, tickets: workOrders, onProgress }),
	});

	return { workOrders: reconciled.kept, skipped: [...skipped, ...reconciled.leftBehind] };
};
