import type { RunListing } from '@lightsout/engine';
import { formatCost } from '@lightsout/shared';
import { Link } from '@tanstack/react-router';
import { RunStatusBadge } from '#src/appUI/index.ts';
import { formatRelativeTime } from '#src/common/formatting/formatRelativeTime.ts';

interface Props {
	run: RunListing;
}

/** One row of the runs list: what the run was, how it ended, and what it cost. */
export const RunListItem = ({ run }: Props) => (
	<Link
		to="/runs/$runId"
		params={{ runId: run.runId }}
		className="flex flex-col gap-1.5 rounded-md border border-transparent px-3 py-2 transition-colors hover:bg-sidebar-accent"
		activeProps={{ className: 'border-sidebar-border bg-sidebar-accent-selected' }}
	>
		<div className="flex items-start justify-between gap-2">
			<span className="min-w-0 truncate font-medium text-sm">{run.title}</span>
			<RunStatusBadge status={run.status} live={run.live} />
		</div>
		<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground text-xs">
			<span className="font-mono">{run.shortId}</span>
			<span>·</span>
			<span>{formatRelativeTime({ at: run.updatedAt })}</span>
			<span>·</span>
			<span>
				{run.stepsPassed}/{run.stepCount} steps
			</span>
			{run.costUsd === undefined ? null : (
				<>
					<span>·</span>
					<span>{formatCost({ usd: run.costUsd })}</span>
				</>
			)}
		</div>
	</Link>
);
