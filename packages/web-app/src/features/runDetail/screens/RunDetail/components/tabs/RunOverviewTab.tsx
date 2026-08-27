import { PipelineKind } from '@lightsout/engine/contracts';
import { formatCost, formatDuration } from '@lightsout/shared';
import { Card, StatusBadge } from '#src/appUI/index.ts';
import { statusBadgeConfig } from '#src/common/constants/statusBadgeConfig.ts';
import { formatCount } from '#src/common/formatting/formatCount.ts';
import { StepReportKind } from '#src/features/runDetail/common/constants/StepReportKind.ts';
import type { RunDetailStep } from '#src/features/runDetail/common/types/RunDetailStep.ts';
import type { RunDetailView } from '#src/features/runDetail/common/types/RunDetailView.ts';
import { summarizeStepReport } from '#src/features/runDetail/common/utils/summarizeStepReport.ts';
import { BurnDownPanel } from '#src/features/runDetail/screens/RunDetail/components/BurnDownPanel.tsx';
import { PhaseList } from '#src/features/runDetail/screens/RunDetail/components/PhaseList.tsx';
import { RunTimeline } from '#src/features/runDetail/screens/RunDetail/components/RunTimeline.tsx';

/** A step's report in one line — the whole report is a tab away, so this only has to say which step is worth opening. */
const describeReport = ({ report }: { report?: object }) => {
	const summary = summarizeStepReport({ report });
	let line = '';

	if (summary?.kind === StepReportKind.Batch) {
		line = `${summary.outcome} · ${formatCount({ count: summary.remaining, noun: 'site' })} still standing`;
	} else if (summary?.kind === StepReportKind.Phase) {
		line = `implemented by run ${summary.runId.slice(0, 8)}`;
	} else if (summary?.kind === StepReportKind.Writers) {
		line = `${formatCount({ count: summary.count, noun: 'writer batch', plural: 'writer batches' })} · ${formatCount({ count: summary.fileCount, noun: 'file' })}`;
	} else if (summary?.kind === StepReportKind.Work) {
		line = summary.summary;
	}

	return line;
};

/** One step, compressed to a row: how it ended, what it cost, and what it said. */
const StepRow = ({ step, onOpen }: { step: RunDetailStep; onOpen: () => void }) => (
	<button
		type="button"
		onClick={onOpen}
		className="flex w-full flex-col gap-1 rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-accent"
	>
		<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
			<span className="font-medium font-mono text-sm">{step.id}</span>
			<StatusBadge status={step.status} config={statusBadgeConfig} />
			<span className="text-muted-foreground text-xs">
				{formatDuration({ ms: step.durationMs })} · {formatCount({ count: step.attempts, noun: 'attempt' })} ·{' '}
				{formatCount({ count: step.changedFiles.length, noun: 'file' })} · {formatCost({ usd: step.costUsd })}
			</span>
		</span>
		<span className="text-muted-foreground text-xs">{describeReport({ report: step.report })}</span>
	</button>
);

interface Props {
	view: RunDetailView;
	/** Opens one step's full card in the Steps tab. */
	onOpenStep: (stepId: string) => void;
	/** Render every router link as plain mono text — the demo frame, whose targets are not routable. Defaults false. */
	linksDisabled?: boolean;
}

/**
 * The run at a glance: where the time went, what it burned down, and one row
 * per step.
 *
 * The rows are deliberately compact — a reader lands here to find which step is
 * worth opening, not to read every report at once, and the Steps tab is where
 * the full cards live.
 */
export const RunOverviewTab = ({ view, onOpenStep, linksDisabled = false }: Props) => (
	<div className="flex flex-col gap-6">
		<Card title="Timeline">
			<RunTimeline steps={view.steps} activeMs={view.activeMs} />
		</Card>
		{view.burnDown === undefined ? null : <BurnDownPanel burnDown={view.burnDown} pipeline={view.listing.pipeline} />}
		{view.listing.pipeline === PipelineKind.Phases ? <PhaseList steps={view.steps} linksDisabled={linksDisabled} /> : null}
		<div className="flex flex-col gap-2">
			{view.steps.map((step) => (
				<StepRow key={step.id} step={step} onOpen={() => onOpenStep(step.id)} />
			))}
		</div>
	</div>
);
