import type { PlanDocument } from '@lightsout/engine';
import { useQuery } from '@tanstack/react-query';
import { CopyButton, Dialog, Markdown, Skeleton } from '#src/appUI/index.ts';
import { planQueryOptions } from '#src/features/runDetail/queries/planQueryOptions.ts';
import { WorklistView } from '#src/features/runDetail/screens/RunDetail/components/WorklistView.tsx';

/** The document as text a reader can paste elsewhere: a plan's own markdown, or a work-list's JSON. */
const getRawText = ({ plan }: { plan: PlanDocument }) => {
	const payload = plan.worklist ?? plan.coverageWorklist;

	return plan.text ?? (payload === undefined ? undefined : JSON.stringify(payload, null, 2));
};

/** Whichever of the three things a recorded plan path turned out to be. */
const PlanBody = ({ plan }: { plan: PlanDocument }) => {
	if (plan.text !== undefined) {
		return <Markdown text={plan.text} />;
	}

	if (plan.worklist !== undefined || plan.coverageWorklist !== undefined) {
		return <WorklistView plan={plan} />;
	}

	return (
		<p className="text-muted-foreground text-sm">
			Nothing is on disk at <span className="font-mono">{plan.path}</span> — a plan deleted after its run is a normal state, not an error.
		</p>
	);
};

/**
 * The drawer's contents once a path has been chosen.
 *
 * Its own component so the fetch only exists while the drawer is open: a plan
 * is read when a reader asks for it and kept thereafter, since a plan file does
 * not change under a run that has already read it.
 */
const PlanDialog = ({ path, onClose }: { path: string; onClose: () => void }) => {
	const { data: plan } = useQuery(planQueryOptions({ path }));
	const raw = plan === undefined ? undefined : getRawText({ plan });

	return (
		<Dialog open onOpenChange={() => onClose()} title={path} action={raw === undefined ? null : <CopyButton value={raw} label="Copy raw" />}>
			{plan === undefined ? <Skeleton className="h-64 w-full" /> : <PlanBody plan={plan} />}
		</Dialog>
	);
};

interface Props {
	/** Repo-relative plan path the drawer is showing; nothing is open when this is absent. */
	path?: string;
	onClose: () => void;
}

/** The plan a run implemented, shown beside the evidence it produced. */
export const PlanDrawer = ({ path, onClose }: Props) => (path === undefined ? null : <PlanDialog path={path} onClose={onClose} />);
