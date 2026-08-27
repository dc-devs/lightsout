import type { RunDetailView } from '#src/features/runDetail/common/types/RunDetailView.ts';
import { StepCard } from '#src/features/runDetail/screens/RunDetail/components/StepCard.tsx';

interface Props {
	view: RunDetailView;
	/** Opens a repo-relative plan path in the drawer the page owns. */
	onOpenPlan: (path: string) => void;
	/** Render every router link as plain mono text — the demo frame, whose child runs are in no public listing. Defaults false. */
	linksDisabled?: boolean;
}

/** Every step in full, in the order the run took them — each anchored by its id so the overview can jump to one. */
export const RunStepsTab = ({ view, onOpenPlan, linksDisabled = false }: Props) => (
	<div className="flex flex-col gap-3">
		{view.steps.map((step) => (
			<StepCard key={step.id} step={step} onOpenPlan={onOpenPlan} linksDisabled={linksDisabled} />
		))}
	</div>
);
