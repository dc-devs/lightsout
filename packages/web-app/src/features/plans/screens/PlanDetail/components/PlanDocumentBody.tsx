import { useQuery } from '@tanstack/react-query';
import { Markdown, Skeleton } from '#src/appUI/index.ts';
import { planQueryOptions } from '#src/features/runDetail/index.ts';

interface Props {
	/** Repo-relative path of a markdown file inside the workspace. */
	path: string;
}

/**
 * One markdown file of a plan workspace, read through the same query the run
 * detail's plan drawer uses — so a plan opened from a run and the same plan
 * opened from this page are one cached document rather than two fetches.
 *
 * A path with nothing behind it renders as a recorded absence, matching
 * `getPlanDocument`'s own habit: a file deleted after its run is a normal state,
 * not an error.
 */
export const PlanDocumentBody = ({ path }: Props) => {
	const { data: plan } = useQuery(planQueryOptions({ path }));

	if (plan === undefined) {
		return <Skeleton className="h-64 w-full" />;
	}

	return plan.text === undefined ? <p className="text-muted-foreground text-sm">Nothing is on disk at that path any more.</p> : <Markdown text={plan.text} />;
};
