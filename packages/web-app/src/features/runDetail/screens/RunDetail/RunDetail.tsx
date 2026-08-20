import { useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card } from '#src/common/components/ui/Card.tsx';
import { runQueryOptions } from '#src/features/runDetail/queries/runQueryOptions.ts';
import { AgentCostPanel } from '#src/features/runDetail/screens/RunDetail/components/AgentCostPanel.tsx';
import { ChangedFilesPanel } from '#src/features/runDetail/screens/RunDetail/components/ChangedFilesPanel.tsx';
import { FrictionPanel } from '#src/features/runDetail/screens/RunDetail/components/FrictionPanel.tsx';
import { GateEvidencePanel } from '#src/features/runDetail/screens/RunDetail/components/GateEvidencePanel.tsx';
import { PlanDrawer } from '#src/features/runDetail/screens/RunDetail/components/PlanDrawer.tsx';
import { RunHeader } from '#src/features/runDetail/screens/RunDetail/components/RunHeader.tsx';
import { RunTimeline } from '#src/features/runDetail/screens/RunDetail/components/RunTimeline.tsx';
import { StepCard } from '#src/features/runDetail/screens/RunDetail/components/StepCard.tsx';

interface Props {
	/** Full run id, or the shortened form a report printed. */
	runId: string;
}

/**
 * One run's whole evidence, in the order the terminal report card prints it:
 * who the run was, where the time went, what each step did, what the gates
 * said, what the agents cost, what fought them, and what changed.
 *
 * Every number on this page comes from one `RunView` the engine assembled —
 * nothing here parses a file or re-derives a total, so the page and the report
 * card cannot disagree. The one piece of view state is which plan the drawer is
 * showing.
 */
export const RunDetail = ({ runId }: Props) => {
	const { data: view } = useSuspenseQuery(runQueryOptions({ runId }));
	const [planPath, setPlanPath] = useState<string | undefined>(undefined);

	return (
		<div className="flex flex-col gap-6 p-8">
			<RunHeader view={view} onOpenPlan={setPlanPath} />
			<Card title="Timeline">
				<RunTimeline steps={view.steps} activeMs={view.activeMs} />
			</Card>
			<div className="flex flex-col gap-3">
				{view.steps.map((step) => (
					<StepCard key={step.id} step={step} onOpenPlan={setPlanPath} />
				))}
			</div>
			<GateEvidencePanel gates={view.gates} totals={view.gateTotals} />
			<AgentCostPanel usage={view.usage} cacheReadShare={view.cacheReadShare} steps={view.steps} agents={view.agents} rejectedReports={view.rejectedReports} />
			<FrictionPanel records={view.friction} />
			<ChangedFilesPanel files={view.changedFiles} unreachable={view.unreachableChangedFiles} />
			<PlanDrawer path={planPath} onClose={() => setPlanPath(undefined)} />
		</div>
	);
};
