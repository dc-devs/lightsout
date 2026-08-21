import type { RunStepView } from '@lightsout/engine';
import { formatCost, formatDuration, formatTokenCount } from '@lightsout/shared';
import { Link } from '@tanstack/react-router';
import { RunStatusBadge } from '#src/common/components/ui/RunStatusBadge.tsx';
import { formatCount } from '#src/common/formatting/formatCount.ts';
import { summarizeStepReport } from '#src/features/runDetail/common/utils/summarizeStepReport.ts';
import { FailureNotice } from '#src/features/runDetail/screens/RunDetail/components/FailureNotice.tsx';
import { PlanPathButton } from '#src/features/runDetail/screens/RunDetail/components/PlanPathButton.tsx';
import { StepReportSummary } from '#src/features/runDetail/screens/RunDetail/components/StepReportSummary.tsx';

interface Props {
	step: RunStepView;
	/** Opens a repo-relative plan path in the drawer. */
	onOpenPlan: (path: string) => void;
}

/**
 * One pipeline step: how it ended, what it cost, and its own report.
 *
 * Anchored by its id so the timeline above can jump to it. A step's report is
 * read by shape rather than by the step's name — the manifest stores it
 * opaquely, and the role that produced it is what decides what it holds.
 */
export const StepCard = ({ step, onOpenPlan }: Props) => {
	const report = summarizeStepReport({ report: step.report });

	return (
		<article id={`step-${step.id}`} className="scroll-mt-4 rounded-lg border border-border bg-card">
			<header className="flex flex-wrap items-center justify-between gap-3 border-border border-b px-4 py-3">
				<div className="flex min-w-0 items-center gap-3">
					<span className="truncate font-medium font-mono text-sm">{step.id}</span>
					<RunStatusBadge status={step.status} />
				</div>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
					<span>{formatDuration({ ms: step.durationMs })}</span>
					<span>·</span>
					<span>{formatCount({ count: step.attempts, noun: 'attempt' })}</span>
					<span>·</span>
					<span>{formatCount({ count: step.changedFiles.length, noun: 'file' })}</span>
					<span>·</span>
					<span>{formatCount({ count: step.invocations, noun: 'invocation' })}</span>
					<span>·</span>
					<span>out {formatTokenCount({ count: step.outputTokens })}</span>
					<span>·</span>
					<span>{formatCost({ usd: step.costUsd })}</span>
				</div>
			</header>
			<div className="flex flex-col gap-3 px-4 py-3">
				{step.error === undefined ? null : <FailureNotice>{step.error}</FailureNotice>}
				{step.childRunId === undefined ? null : (
					<p className="text-muted-foreground text-xs">
						implemented by run{' '}
						<Link to="/runs/$runId" params={{ runId: step.childRunId }} className="font-mono text-primary underline underline-offset-2">
							{step.childRunId.slice(0, 8)}
						</Link>
					</p>
				)}
				{step.planPath === undefined ? null : <PlanPathButton path={step.planPath} onOpenPlan={onOpenPlan} />}
				{report === undefined ? <p className="text-muted-foreground text-sm">No report recorded for this step.</p> : <StepReportSummary report={report} />}
			</div>
		</article>
	);
};
