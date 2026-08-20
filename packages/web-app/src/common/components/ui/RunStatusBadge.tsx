import { RunStatus } from '@lightsout/engine/contracts';
import { Badge } from '#src/common/components/ui/Badge.tsx';
import { runStatusFamilies } from '#src/common/constants/runStatusFamilies.ts';

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

/** The one place a run status becomes a colour and a word. */
export const RunStatusBadge = ({ status, live = false }: Props) => (
	<Badge variant={runStatusFamilies[status]}>
		{live ? <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-current" /> : null}
		{statusLabels[status]}
	</Badge>
);
