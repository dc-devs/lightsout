import { useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { runQueryOptions } from '#src/features/runDetail/queries/runQueryOptions.ts';
import { RunDetailBody } from '#src/features/runDetail/screens/RunDetail/components/RunDetailBody.tsx';
import { PlanDrawer } from '#src/features/runDetail/screens/RunDetail/internal/components/PlanDrawer.tsx';

interface Props {
	/** Full run id, or the shortened form a report printed. */
	runId: string;
}

/**
 * The run detail page: one run's evidence, and the drawer that opens whichever
 * plan the reader asked to see.
 *
 * The evidence itself is `RunDetailBody`. What is left here is the page's own
 * two concerns — the query it suspends on, and the one piece of view state it
 * owns.
 */
export const RunDetail = ({ runId }: Props) => {
	const { data: view } = useSuspenseQuery(runQueryOptions({ runId }));
	const [planPath, setPlanPath] = useState<string | undefined>(undefined);

	return (
		<>
			<RunDetailBody view={view} onOpenPlan={setPlanPath} />
			<PlanDrawer path={planPath} onClose={() => setPlanPath(undefined)} />
		</>
	);
};
