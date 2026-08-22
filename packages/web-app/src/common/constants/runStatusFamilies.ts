import { RunStatus } from '@lightsout/engine/contracts';
import { BadgeVariant } from '#src/common/constants/BadgeVariant.ts';

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
export const runStatusFamilies: Record<RunStatus, BadgeVariant> = {
	[RunStatus.Pending]: BadgeVariant.Neutral,
	[RunStatus.Running]: BadgeVariant.Running,
	[RunStatus.Passed]: BadgeVariant.Passed,
	[RunStatus.Failed]: BadgeVariant.Failed,
	[RunStatus.PausedRateLimit]: BadgeVariant.Paused,
	[RunStatus.PausedBudget]: BadgeVariant.Paused,
	[RunStatus.Escalated]: BadgeVariant.Escalated,
};
