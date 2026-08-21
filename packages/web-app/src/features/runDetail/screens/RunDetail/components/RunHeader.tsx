import type { RunView } from '@lightsout/engine';
import { RunStatus } from '@lightsout/engine/contracts';
import { formatCost, formatDuration } from '@lightsout/shared';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { CopyButton } from '#src/common/components/ui/CopyButton.tsx';
import { RunStatusBadge } from '#src/common/components/ui/RunStatusBadge.tsx';
import { FailureNotice } from '#src/features/runDetail/screens/RunDetail/components/FailureNotice.tsx';
import { PlanPathButton } from '#src/features/runDetail/screens/RunDetail/components/PlanPathButton.tsx';

/** One labelled number or word in the header's totals row. */
const Meta = ({ label, value }: { label: string; value: ReactNode }) => (
	<div className="flex flex-col gap-0.5">
		<span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
		<span className="font-medium text-sm">{value}</span>
	</div>
);

interface Props {
	view: RunView;
	/** Opens a repo-relative plan path in the drawer. */
	onOpenPlan: (path: string) => void;
}

/**
 * Who this run is, how it ended, and the four numbers a reader wants first.
 *
 * Wall time and active time are deliberately shown side by side: the first
 * includes the idle gap between a failure and its resume, the second is the
 * working time the steps actually took, and presenting either one as the other
 * would misreport what the run cost.
 *
 * A run the manifest still calls `running` with no process behind it says so in
 * words — the manifest alone is not the whole truth once a process has died.
 */
export const RunHeader = ({ view, onOpenPlan }: Props) => {
	const { listing } = view;
	const resumeCommand = `lightsout resume --run ${listing.shortId}`;

	return (
		<header className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-3">
				<h1 className="font-semibold text-2xl">{listing.title}</h1>
				<RunStatusBadge status={listing.status} live={listing.live} />
				{listing.status === RunStatus.Running && view.currentStep !== null ? (
					<span className="text-muted-foreground text-sm">
						at <span className="font-mono">{view.currentStep}</span>
					</span>
				) : null}
			</div>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
				<span className="font-mono">{listing.shortId}</span>
				<CopyButton value={listing.shortId} label="Copy id" />
				<span>{view.harness}</span>
				<span>·</span>
				<span>{listing.pipeline}</span>
				{listing.packages.length === 0 ? null : (
					<>
						<span>·</span>
						<span>{listing.packages.join(' · ')}</span>
					</>
				)}
			</div>
			{listing.status === RunStatus.Running && !listing.live ? (
				<FailureNotice>The manifest still says running, but no process stands behind it — the run died without recording an ending.</FailureNotice>
			) : null}
			{view.parent === undefined ? null : (
				<p className="text-muted-foreground text-xs">
					phase <span className="font-mono">{view.parent.step}</span> of{' '}
					<Link to="/runs/$runId" params={{ runId: view.parent.runId }} className="text-primary underline underline-offset-2">
						{view.parent.title}
					</Link>
				</p>
			)}
			<div className="flex flex-col items-start gap-1">
				<PlanPathButton label="plan" path={listing.plan} onOpenPlan={onOpenPlan} />
				{view.overview === undefined ? null : <PlanPathButton label="overview" path={view.overview} onOpenPlan={onOpenPlan} />}
			</div>
			<div className="flex flex-wrap gap-x-10 gap-y-3">
				<Meta label="wall" value={formatDuration({ ms: view.wallMs })} />
				<Meta label="active" value={formatDuration({ ms: view.activeMs })} />
				<Meta label="gates" value={formatDuration({ ms: view.gateMs })} />
				<Meta label="cost" value={view.usage === undefined ? '—' : formatCost({ usd: view.usage.costUsd })} />
			</div>
			{listing.resumable ? (
				<div className="flex items-center gap-2">
					<code className="rounded-md bg-muted px-2 py-1 font-mono text-xs">{resumeCommand}</code>
					<CopyButton value={resumeCommand} label="Copy resume command" />
				</div>
			) : null}
		</header>
	);
};
