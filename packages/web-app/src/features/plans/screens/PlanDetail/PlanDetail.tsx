import { useSuspenseQuery } from '@tanstack/react-query';
import { ContentHeader, Tabs } from '#src/appUI/index.ts';
import { planWorkspaceQueryOptions } from '#src/features/plans/queries/planWorkspaceQueryOptions.ts';
import { PlanDetailTab } from '#src/features/plans/screens/PlanDetail/common/constants/PlanDetailTab.ts';
import { DecisionsTab } from '#src/features/plans/screens/PlanDetail/components/DecisionsTab.tsx';
import { DedupTab } from '#src/features/plans/screens/PlanDetail/components/DedupTab.tsx';
import { FactsTab } from '#src/features/plans/screens/PlanDetail/components/FactsTab.tsx';
import { GradeTab } from '#src/features/plans/screens/PlanDetail/components/GradeTab.tsx';
import { NotesTab } from '#src/features/plans/screens/PlanDetail/components/NotesTab.tsx';
import { PlanHeader } from '#src/features/plans/screens/PlanDetail/components/PlanHeader.tsx';
import { PlanTab } from '#src/features/plans/screens/PlanDetail/components/PlanTab.tsx';

interface Props {
	/** The workspace's kebab folder name, which is what the URL carries. */
	name: string;
}

/**
 * One plan workspace, whole: what it is and how far it got, then six tabs over
 * the records the planning commands left behind.
 *
 * The active tab is component state rather than a URL parameter, matching the
 * run detail: a tab is where a reader is looking, and the plans page keeps the
 * one thing worth sending in a link — the stage filter — in its own URL.
 */
export const PlanDetail = ({ name }: Props) => {
	const { data: view } = useSuspenseQuery(planWorkspaceQueryOptions({ name }));

	return (
		<div className="flex flex-col gap-6 p-6">
			<ContentHeader crumbs={[{ label: 'Your repo', link: { to: '/repo' } }, { label: 'Plans', link: { to: '/repo/plans' } }, { label: view.listing.name }]} />
			<PlanHeader view={view} />
			<Tabs
				items={[
					{ value: PlanDetailTab.Plan, label: 'Plan', content: <PlanTab view={view} /> },
					{ value: PlanDetailTab.Decisions, label: 'Decisions', content: <DecisionsTab view={view} /> },
					{ value: PlanDetailTab.Facts, label: 'Facts', content: <FactsTab facts={view.facts} /> },
					{ value: PlanDetailTab.Grade, label: 'Grade', content: <GradeTab grade={view.grade} /> },
					{ value: PlanDetailTab.Dedup, label: 'Dedup', content: <DedupTab dedup={view.dedup} /> },
					{ value: PlanDetailTab.Notes, label: 'Notes', content: <NotesTab view={view} /> },
				]}
			/>
		</div>
	);
};
