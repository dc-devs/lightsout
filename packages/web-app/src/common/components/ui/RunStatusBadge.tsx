import { RunStatus } from '@lightsout/engine/contracts';
import { Badge } from '#src/common/components/ui/Badge.tsx';

/**
 * The one place a run status becomes a colour and a word.
 *
 * Five colour families cover seven statuses: both paused states share one — the
 * distinction that matters to a reader is "stopped, resumable", and the label
 * still says which wall it hit — and `pending` takes the neutral variant
 * because a run that has not started has no state to signal.
 */
const statusVariants = {
	[RunStatus.Pending]: 'neutral',
	[RunStatus.Running]: 'running',
	[RunStatus.Passed]: 'passed',
	[RunStatus.Failed]: 'failed',
	[RunStatus.PausedRateLimit]: 'paused',
	[RunStatus.PausedBudget]: 'paused',
	[RunStatus.Escalated]: 'escalated',
} as const;

const statusLabels = {
	[RunStatus.Pending]: 'pending',
	[RunStatus.Running]: 'running',
	[RunStatus.Passed]: 'passed',
	[RunStatus.Failed]: 'failed',
	[RunStatus.PausedRateLimit]: 'paused · rate limit',
	[RunStatus.PausedBudget]: 'paused · budget',
	[RunStatus.Escalated]: 'escalated',
} as const;

interface Props {
	status: RunStatus;
	/** A live process stands behind this run right now — the engine's own `RunListing.live`. */
	live?: boolean;
}

export const RunStatusBadge = ({ status, live = false }: Props) => (
	<Badge variant={statusVariants[status]}>
		{live ? <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-current" /> : null}
		{statusLabels[status]}
	</Badge>
);
