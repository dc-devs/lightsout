import { useState } from 'react';
import { Tabs } from '#src/appUI/index.ts';
import type { RunDetailView } from '#src/features/runDetail/common/types/RunDetailView.ts';
import { RunDetailTab } from '#src/features/runDetail/screens/RunDetail/common/constants/RunDetailTab.ts';
import { ChangedFilesPanel } from '#src/features/runDetail/screens/RunDetail/components/ChangedFilesPanel.tsx';
import { FrictionPanel } from '#src/features/runDetail/screens/RunDetail/components/FrictionPanel.tsx';
import { RunHeader } from '#src/features/runDetail/screens/RunDetail/components/RunHeader.tsx';
import { RunAgentsTab } from '#src/features/runDetail/screens/RunDetail/components/tabs/RunAgentsTab.tsx';
import { RunGatesTab } from '#src/features/runDetail/screens/RunDetail/components/tabs/RunGatesTab.tsx';
import { RunOverviewTab } from '#src/features/runDetail/screens/RunDetail/components/tabs/RunOverviewTab.tsx';
import { RunStepsTab } from '#src/features/runDetail/screens/RunDetail/components/tabs/RunStepsTab.tsx';

interface Props {
	view: RunDetailView;
	/** Opens a repo-relative plan path in the drawer the page owns. */
	onOpenPlan: (path: string) => void;
	/** Render every router link as plain mono text — the demo frame on Home, whose targets are not routable. Defaults false. */
	linksDisabled?: boolean;
	/** Suppress every shell command a reader would copy — set when no repo was found. Defaults false. */
	commandsDisabled?: boolean;
}

/**
 * One run's whole evidence: who the run was and where it stands, then six tabs
 * over the same `RunView` the engine assembled.
 *
 * The active tab is component state rather than a URL parameter, because the
 * site's proof section renders this over a frozen run inside a browser frame
 * that has no URL of its own — and a page whose tabs write to the address bar
 * could not be shown that way.
 *
 * Separate from the page for the same reason: the page reads its view from a
 * query, this takes one it is handed, and the two therefore cannot drift.
 */
export const RunDetailBody = ({ view, onOpenPlan, linksDisabled = false, commandsDisabled = false }: Props) => {
	const [tab, setTab] = useState<string>(RunDetailTab.Overview);

	const openStep = (stepId: string) => {
		setTab(RunDetailTab.Steps);
		// The card only joins the tree with the Steps panel, so the scroll waits
		// for the frame that mounts it.
		requestAnimationFrame(() => document.getElementById(`step-${stepId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
	};

	return (
		<div className="flex flex-col gap-6 p-8">
			<RunHeader view={view} onOpenPlan={onOpenPlan} linksDisabled={linksDisabled} commandsDisabled={commandsDisabled} />
			<Tabs
				value={tab}
				onValueChange={setTab}
				items={[
					{
						value: RunDetailTab.Overview,
						label: 'Overview',
						content: <RunOverviewTab view={view} onOpenStep={openStep} linksDisabled={linksDisabled} />,
					},
					{ value: RunDetailTab.Steps, label: 'Steps', content: <RunStepsTab view={view} onOpenPlan={onOpenPlan} linksDisabled={linksDisabled} /> },
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
