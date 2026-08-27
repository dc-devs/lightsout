import type { PlanWorkspaceView } from '@lightsout/engine';
import { Link } from '@tanstack/react-router';
import { TriangleAlert } from 'lucide-react';
import { MetadataTag, StatusBadge } from '#src/appUI/index.ts';
import { formatCount } from '#src/common/formatting/formatCount.ts';
import { planGradeBadgeConfig } from '#src/features/plans/common/constants/planGradeBadgeConfig.ts';
import { planStageBadgeConfig } from '#src/features/plans/common/constants/planStageBadgeConfig.ts';

/** Every file that is on disk and will not parse, said out loud — a corrupt workspace is shown rather than quietly rendered as empty. */
const PlanProblems = ({ problems }: { problems: string[] }) => (
	<ul className="flex flex-col gap-1 rounded-lg border border-status-failed-border bg-status-failed-light px-4 py-3 text-sm text-status-failed">
		{problems.map((problem) => (
			<li key={problem} className="flex items-center gap-2">
				<TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-status-failed" />
				{problem}
			</li>
		))}
	</ul>
);

interface Props {
	view: PlanWorkspaceView;
}

/** What this plan is, how far it got, where it lives, and the runs that implemented it. */
export const PlanHeader = ({ view }: Props) => (
	<header className="flex flex-col gap-3">
		{view.problems.length === 0 ? null : <PlanProblems problems={view.problems} />}
		<div className="flex flex-wrap items-center gap-2">
			<h1 className="font-semibold text-2xl">{view.listing.name}</h1>
			<StatusBadge status={view.listing.stage} config={planStageBadgeConfig} />
			{view.listing.grade === undefined ? null : <StatusBadge status={view.listing.grade} config={planGradeBadgeConfig} />}
		</div>
		<MetadataTag className="max-w-full truncate" title={view.rootPath}>
			{view.rootPath}
		</MetadataTag>
		{view.runs.length === 0 ? (
			<p className="text-muted-foreground text-sm">No run has been started from this plan yet.</p>
		) : (
			<div className="flex flex-wrap items-center gap-2 text-sm">
				<span className="text-muted-foreground">{formatCount({ count: view.runs.length, noun: 'run' })}:</span>
				{view.runs.map((run) => (
					<Link
						key={run.runId}
						to="/repo/runs/$runId"
						params={{ runId: run.runId }}
						className="flex min-w-0 items-center gap-2 hover:underline hover:underline-offset-2"
					>
						<MetadataTag>{run.shortId}</MetadataTag>
						<span className="min-w-0 truncate">{run.title}</span>
					</Link>
				))}
			</div>
		)}
	</header>
);
