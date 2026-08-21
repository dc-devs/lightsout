import { RunStatus } from '#src/contracts/index.ts';

/**
 * The glyph the terminal prints for each run/step status.
 *
 * Keyed by `RunStatus` rather than by `string`, so a status added to the union
 * fails the typecheck here instead of reaching a reader as `?` — which is how
 * `paused-budget` came to have no icon at all.
 */
export const statusIcons: Record<RunStatus, string> = {
	[RunStatus.Passed]: '✓',
	[RunStatus.Failed]: '✗',
	[RunStatus.Running]: '…',
	[RunStatus.Pending]: '○',
	[RunStatus.PausedRateLimit]: '⏸',
	// stopped and resumable, exactly like the rate-limit pause
	[RunStatus.PausedBudget]: '⏸',
	[RunStatus.Escalated]: '⚑',
};
