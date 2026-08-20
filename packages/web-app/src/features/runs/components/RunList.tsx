import { useSuspenseQuery } from '@tanstack/react-query';
import { RunListItem } from '#src/features/runs/components/RunListItem.tsx';
import { runsQueryOptions } from '#src/features/runs/queries/runsQueryOptions.ts';

/**
 * Every run on disk, in the order the engine returned them — newest first, no
 * paging, no filtering. A repo with no runs yet is a normal thing to point this
 * at, so it gets a sentence rather than an empty box.
 */
export const RunList = () => {
	const { data: runs } = useSuspenseQuery(runsQueryOptions());

	return runs.length === 0 ? (
		<p className="px-3 py-2 text-muted-foreground text-xs">No runs yet — this repo has no run state on disk.</p>
	) : (
		<ul className="flex flex-col gap-0.5">
			{runs.map((run) => (
				<li key={run.runId}>
					<RunListItem run={run} />
				</li>
			))}
		</ul>
	);
};
