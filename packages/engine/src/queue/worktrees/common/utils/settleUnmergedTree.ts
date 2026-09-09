import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { ParkedTreeBucket } from '#src/queue/worktrees/common/constants/ParkedTreeBucket.ts';
import type { ParkedTree } from '#src/queue/worktrees/common/types/ParkedTree.ts';
import { classifyTree } from '#src/queue/worktrees/common/utils/classifyTree.ts';
import { setTicketLabel, type TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	/** The main repository checkout. */
	cwd: string;
	tree: ParkedTree;
	ticket: TicketSummary;
	defaultBranch: string;
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
	onProgress?: (message: string) => void;
}

/**
 * What a still-delegated, still-unmerged worktree needs next: an outcome the
 * drain reports, or undefined when the tree is drained and its ticket resumes.
 *
 * Clearing the parked label belongs to the resuming half alone — a tree headed
 * for the merge, or one git could not read, stays parked exactly as it is. A
 * label the tracker refuses to clear is a printed sentence rather than a
 * changed answer: the tree is drainable either way, and the drain is where the
 * work is.
 */
export const settleUnmergedTree = async ({
	cwd,
	tree,
	ticket,
	defaultBranch,
	settings,
	trackerSettings,
	onProgress,
}: Params): Promise<TicketRunOutcome | undefined> => {
	const bucket = await classifyTree({ cwd, tree, defaultBranch, onProgress });

	if (bucket === ParkedTreeBucket.Drain) {
		const cleared = await setTicketLabel({ settings: trackerSettings, ticketId: ticket.id, label: settings.parkedLabel, present: false });

		if (cleared !== undefined) {
			onProgress?.(`${tree.identifier} · the parked label could not be cleared: ${cleared.error}`);
		}

		return undefined;
	}

	return {
		ticket,
		branch: tree.branch,
		worktreePath: tree.path,
		ready: bucket === ParkedTreeBucket.Ship,
		error: bucket === ParkedTreeBucket.Ship ? undefined : `git could not read the worktree at ${tree.path}`,
	};
};
