import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { repoRootQueryOptions } from '#src/features/app/index.ts';
import { runQueryOptions } from '#src/features/runDetail/queries/runQueryOptions.ts';
import { PlanDrawer } from '#src/features/runDetail/screens/RunDetail/components/PlanDrawer.tsx';
import { RunDetailBody } from '#src/features/runDetail/screens/RunDetail/components/RunDetailBody.tsx';

interface Props {
	/** Full run id, or the shortened form a report printed. */
	runId: string;
}

/**
 * The run detail page: one run's evidence, and the drawer that opens whichever
 * plan the reader asked to see.
 *
 * The evidence itself is `RunDetailBody`, which the site's proof section renders
 * too. What is left here is the page's own three concerns — the query it
 * suspends on, the one piece of view state it owns, and whether this machine
 * has a repo the printed commands would work against.
 */
export const RunDetail = ({ runId }: Props) => {
	const { data: view } = useSuspenseQuery(runQueryOptions({ runId }));
	const { data: repo } = useQuery(repoRootQueryOptions());
	const [planPath, setPlanPath] = useState<string | undefined>(undefined);

	return (
		<>
			<RunDetailBody view={view} onOpenPlan={setPlanPath} commandsDisabled={repo?.repoRoot === undefined} />
			<PlanDrawer path={planPath} onClose={() => setPlanPath(undefined)} />
		</>
	);
};
