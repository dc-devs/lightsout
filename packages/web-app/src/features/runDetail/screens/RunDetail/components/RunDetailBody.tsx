import { useState } from 'react';
import { Tabs } from '#src/appUI/Tabs.tsx';
import type { RunDetailView } from '#src/features/runDetail/internal/common/types/RunDetailView.ts';
import { RunDetailTab } from '#src/features/runDetail/screens/RunDetail/internal/common/constants/RunDetailTab.ts';
import { ChangedFilesPanel } from '#src/features/runDetail/screens/RunDetail/internal/components/ChangedFilesPanel.tsx';
import { FrictionPanel } from '#src/features/runDetail/screens/RunDetail/internal/components/FrictionPanel.tsx';
import { RunHeader } from '#src/features/runDetail/screens/RunDetail/internal/components/RunHeader.tsx';
import { RunAgentsTab } from '#src/features/runDetail/screens/RunDetail/internal/components/tabs/RunAgentsTab.tsx';
import { RunGatesTab } from '#src/features/runDetail/screens/RunDetail/internal/components/tabs/RunGatesTab.tsx';
import { RunOverviewTab } from '#src/features/runDetail/screens/RunDetail/internal/components/tabs/RunOverviewTab.tsx';
import { RunStepsTab } from '#src/features/runDetail/screens/RunDetail/internal/components/tabs/RunStepsTab.tsx';

interface Props {
	view: RunDetailView;
	/** Opens a repo-relative plan path in the drawer the page owns. */
	onOpenPlan: (path: string) => void;
}

/**
 * One run's whole evidence: who the run was and where it stands, then six tabs
 * over the same `RunView` the engine assembled.
 *
 * Takes the view it is handed rather than reading a query, so the page keeps
 * the suspending read and the plan drawer, and this keeps only the evidence.
 */
export const RunDetailBody = ({ view, onOpenPlan }: Props) => {
	const [tab, setTab] = useState<string>(RunDetailTab.Overview);

	const openStep = (stepId: string) => {
		setTab(RunDetailTab.Steps);
		// The card only joins the tree with the Steps panel, so the scroll waits
		// for the frame that mounts it.
		requestAnimationFrame(() => document.getElementById(`step-${stepId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
	};

	return (
		<div className="flex flex-col gap-6 p-8">
			<RunHeader view={view} onOpenPlan={onOpenPlan} />
			<Tabs
				value={tab}
				onValueChange={setTab}
				items={[
					{
						value: RunDetailTab.Overview,
						label: 'Overview',
						content: <RunOverviewTab view={view} onOpenStep={openStep} />,
					},
					{ value: RunDetailTab.Steps, label: 'Steps', content: <RunStepsTab view={view} onOpenPlan={onOpenPlan} /> },
					{ value: RunDetailTab.Gates, label: 'Gates', content: <RunGatesTab view={view} /> },
					{ value: RunDetailTab.Agents, label: 'Agents', content: <RunAgentsTab view={view} /> },
					{
						value: RunDetailTab.Files,
						label: 'Files',
						content: <ChangedFilesPanel files={view.changedFiles} unreachable={view.unreachableChangedFiles} />,
					},
					{ value: RunDetailTab.Friction, label: 'Friction', content: <FrictionPanel records={view.friction} /> },
				]}
			/>
		</div>
	);
};
