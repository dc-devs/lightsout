import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { MergedParkedTree } from '#src/queue/common/types/MergedParkedTree.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import { settleReconciledWorktree } from '#src/queue/common/utils/settleReconciledWorktree.ts';
import { reconcileShippedTicket } from '#src/ticketLifecycle/index.ts';
import { setParkedLabel, type TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	/** The main repository checkout. */
	cwd: string;
	config: LightsoutConfig;
	/** The process environment the tracker credentials are read from. Passed rather than read, so a test never needs to mutate `process.env`. */
	env: NodeJS.ProcessEnv;
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
	/** The parked worktrees the scan found already recorded merged. */
	merged: MergedParkedTree[];
	onProgress?: (message: string) => void;
}

/**
 * Every parked worktree whose branch was already recorded merged, finished: the
 * ticket reconciled to done, the clean worktree removed, the parked label
 * cleared, and one settled entry each saying so.
 *
 * Sequential rather than parallel, for the reason `reconcileMergedTickets`
 * gives: an iteration removes a worktree in the main checkout, and the queue's
 * rule is that main-checkout mutations do not overlap.
 *
 * The merge itself already happened, so nothing here can fail in a way that
 * makes it un-happen: every failure becomes a sentence appended to the reason.
 */
export const settleMergedTrees = async ({ cwd, config, env, settings, trackerSettings, merged, onProgress }: Params): Promise<LeftBehindTicket[]> => {
	const settled: LeftBehindTicket[] = [];

	for (const tree of merged) {
		const reconciliationFailure = await reconcileShippedTicket({ config, env, ticketRef: tree.ticket.identifier, onProgress });

		if (reconciliationFailure !== undefined) {
			onProgress?.(reconciliationFailure);
		}

		const heldWorktree = await settleReconciledWorktree({ cwd, worktreePath: tree.worktreePath, branch: tree.branch, onProgress });
		// The ticket is finished, so the label that says a human is needed comes
		// off; a tracker that refuses it is a progress line and nothing more.
		const cleared = await setParkedLabel({ settings: trackerSettings, ticketId: tree.ticket.id, label: settings.parkedLabel, parked: false });

		if (cleared !== undefined) {
			onProgress?.(`${tree.ticket.identifier} · the parked label could not be cleared: ${cleared.error}`);
		}

		const reason = `its worktree at ${tree.worktreePath} held a branch already recorded merged, so the ticket was reconciled to done rather than resumed${heldWorktree ?? ''}${reconciliationFailure === undefined ? '' : ` — ${reconciliationFailure}`}`;

		onProgress?.(`${tree.ticket.identifier} · ${reason}`);
		settled.push({ identifier: tree.ticket.identifier, reason, settled: true });
	}

	return settled;
};
