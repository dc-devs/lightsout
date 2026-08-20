import { useSuspenseQuery } from '@tanstack/react-query';
import { repoRootQueryOptions } from '#src/features/app/queries/repoRootQueryOptions.ts';
import { runsQueryOptions } from '#src/features/runs/index.ts';

/**
 * The landing pane: nothing is open yet, so it says where to click and how much
 * there is to click on — the run count and the repo those runs were read from.
 */
export const RunsIndex = () => {
	const {
		data: { repoRoot },
	} = useSuspenseQuery(repoRootQueryOptions());
	const { data: runs } = useSuspenseQuery(runsQueryOptions());

	return (
		<div className="flex h-full flex-col items-start justify-center gap-2 p-10">
			<h1 className="font-semibold text-lg">Pick a run on the left.</h1>
			<p className="text-muted-foreground text-sm">
				{runs.length} {runs.length === 1 ? 'run' : 'runs'} found in <span className="font-mono">{repoRoot}</span>
			</p>
		</div>
	);
};
