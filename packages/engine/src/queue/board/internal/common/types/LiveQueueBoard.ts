import type { QueueLane } from '#src/contracts/queue/QueueLane.ts';
import type { QueueBoardLanes } from '#src/queue/board/internal/common/types/QueueBoardLanes.ts';

/** A drain still running: its lanes, plus what only the board recorder knows. */
export interface LiveQueueBoard extends QueueBoardLanes {
	/** The question each waiting worker asked, keyed by lower-cased identifier. */
	questions: ReadonlyMap<string, string>;
	/** The lane each ticket was last recorded in and when it entered it, keyed by lower-cased identifier. */
	entered: ReadonlyMap<string, { lane: QueueLane; at: string }>;
	/** The repository's worktrees root, joined with a work order's label to name its worktree. */
	worktreesRoot: string;
}
