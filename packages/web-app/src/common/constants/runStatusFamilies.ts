import { RunStatus } from '@lightsout/engine/contracts';

/**
 * The colour family every run status belongs to — the one table both the status
 * badge's variant and the timeline's segment colour read, so a new status is a
 * one-file edit.
 *
 * Six families cover seven statuses: both paused states share one — the
 * distinction that matters to a reader is "stopped, resumable", and the label
 * still says which wall it hit — and `pending` is neutral because a run that has
 * not started has no state to signal.
 */
export const runStatusFamilies = {
	[RunStatus.Pending]: 'neutral',
	[RunStatus.Running]: 'running',
	[RunStatus.Passed]: 'passed',
	[RunStatus.Failed]: 'failed',
	[RunStatus.PausedRateLimit]: 'paused',
	[RunStatus.PausedBudget]: 'paused',
	[RunStatus.Escalated]: 'escalated',
} as const;
