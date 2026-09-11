import type { QueueLane } from '#src/contracts/index.ts';
import type { QueueBoardLanes } from '#src/queue/board/common/types/QueueBoardLanes.ts';

/** A drain still running: its lanes, plus what only the board recorder knows. */
export interface LiveQueueBoard extends QueueBoardLanes {
	/** The question each waiting worker asked, keyed by lower-cased identifier. */
	questions: ReadonlyMap<string, string>;
	/** The lane each ticket was last recorded in and when it entered it, keyed by lower-cased identifier. */
	entered: ReadonlyMap<string, { lane: QueueLane; at: string }>;
	/** The queue's branch template, to name the branch of a ticket that has no outcome yet. */
	branchTemplate: string;
	/** The repository's worktrees root, joined with a branch to name its worktree. */
	worktreesRoot: string;
}
