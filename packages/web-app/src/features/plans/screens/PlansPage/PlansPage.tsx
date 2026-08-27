import { PlanStage } from '@lightsout/engine/contracts';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { NotebookPen } from 'lucide-react';
import { Button, EmptyState, FilterDropdown, PageHeader } from '#src/appUI/index.ts';
import { formatCount } from '#src/common/formatting/formatCount.ts';
import { planStageLabels } from '#src/features/plans/common/constants/planStageLabels.ts';
import { planWorkspacesQueryOptions } from '#src/features/plans/queries/planWorkspacesQueryOptions.ts';
import { PlansTable } from '#src/features/plans/screens/PlansPage/components/PlansTable.tsx';

/** A repo that has planned nothing yet: the two commands that start a workspace. */
const NoPlansYet = () => <EmptyState icon={NotebookPen} title="No plans yet." description="Run /brainstorm or /plan to start one." />;

/** Plans there are, but none at the stage the reader asked for — so the way out is dropping the filter. */
const NoneAtThisStage = ({ onClear }: { onClear: () => void }) => (
	<EmptyState
		title="No plans at this stage."
		action={
			<Button type="button" variant="outline" size="sm" onClick={onClear}>
				Clear filter
			</Button>
		}
	/>
);

/**
 * Every plan workspace this repo has — the decide half of "humans decide,
 * agents execute".
 *
 * The stage filter lives in the URL rather than in component state, so a
 * narrowed list is a link somebody can send; the write replaces rather than
 * pushes, because back should leave the page rather than unwind one filter edit.
 *
 * Both empty states are chosen here, where the unfiltered listings and the
 * filtered ones are held at once: "no plans yet" and "none at this stage" are
 * different answers, and the shared table cannot tell them apart.
 */
export const PlansPage = () => {
	const { data: listings } = useSuspenseQuery(planWorkspacesQueryOptions());
	const { stage } = useSearch({ from: '/repo/plans/' });
	const navigate = useNavigate({ from: '/repo/plans/' });
	const rows = stage === undefined ? listings : listings.filter((listing) => listing.stage === stage);
	const counts = Object.values(PlanStage).map((value) => ({
		value,
		label: planStageLabels[value],
		count: listings.filter((listing) => listing.stage === value).length,
	}));
	const write = ({ next }: { next?: PlanStage }) => {
		void navigate({ search: { stage: next }, replace: true });
	};

	return (
		<div className="flex flex-col gap-4 p-6">
			<PageHeader
				icon={NotebookPen}
				title="Plans"
				description={`The decide half — what was settled before any agent ran · ${formatCount({ count: listings.length, noun: 'plan' })}`}
			/>
			<div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
				<FilterDropdown
					label="stage"
					multiple={false}
					options={counts}
					selected={stage === undefined ? [] : [stage]}
					onChange={(selected) => write({ next: Object.values(PlanStage).find((value) => value === selected[0]) })}
				/>
			</div>
			<PlansTable listings={rows} empty={listings.length === 0 ? <NoPlansYet /> : <NoneAtThisStage onClear={() => write({})} />} />
		</div>
	);
};
