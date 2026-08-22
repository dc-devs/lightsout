import { RunStatus } from '@lightsout/engine/contracts';
import type { BadgeVariant } from '#src/common/constants/BadgeVariant.ts';
import { runStatusFamilies } from '#src/common/constants/runStatusFamilies.ts';

/**
 * What a run status says and which colour family it says it in — the config map
 * the status badge is handed.
 *
 * The variant is read from `runStatusFamilies` rather than restated, so one
 * table still owns the status-to-family mapping and the timeline and the badge
 * cannot disagree about what `escalated` looks like.
 */
export const statusBadgeConfig: Record<RunStatus, { label: string; variant: BadgeVariant }> = {
	[RunStatus.Pending]: { label: 'pending', variant: runStatusFamilies[RunStatus.Pending] },
	[RunStatus.Running]: { label: 'running', variant: runStatusFamilies[RunStatus.Running] },
	[RunStatus.Passed]: { label: 'passed', variant: runStatusFamilies[RunStatus.Passed] },
	[RunStatus.Failed]: { label: 'failed', variant: runStatusFamilies[RunStatus.Failed] },
	[RunStatus.PausedRateLimit]: { label: 'paused · rate limit', variant: runStatusFamilies[RunStatus.PausedRateLimit] },
	[RunStatus.PausedBudget]: { label: 'paused · budget', variant: runStatusFamilies[RunStatus.PausedBudget] },
	[RunStatus.Escalated]: { label: 'escalated', variant: runStatusFamilies[RunStatus.Escalated] },
};
