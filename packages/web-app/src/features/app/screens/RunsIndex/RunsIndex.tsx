import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { MetadataTag } from '#src/appUI/index.ts';
import { repoRootQueryOptions } from '#src/features/app/queries/repoRootQueryOptions.ts';
import { runsQueryOptions } from '#src/features/runs/index.ts';

/**
 * The "Your repo" zone's landing pane: whether this machine has a repo to read
 * at all, and — when it does — how much run state is in it and the way into
 * that list.
 *
 * No repo is a normal thing to open this on: the sell zone is readable without
 * one, and a deep link into `/repo` on a public build lands here. Both answers
 * are the same shape — a heading over a sentence — so the pane itself owns the
 * layout and the branch decides only what it says.
 */
export const RunsIndex = () => {
	const {
		data: { repoRoot },
	} = useSuspenseQuery(repoRootQueryOptions());
	const { data: runs } = useSuspenseQuery(runsQueryOptions());

	return (
		<div className="flex h-full flex-col items-start justify-center gap-2 p-10">
			<h1 className="font-semibold text-lg">Your repo</h1>
			{repoRoot === undefined ? (
				<p className="text-muted-foreground text-sm">
					No lightsout repo found above this directory — set <MetadataTag>LIGHTSOUT_REPO</MetadataTag> or run from inside one.
				</p>
			) : (
				<>
					<p className="flex flex-wrap items-center gap-1 text-muted-foreground text-sm">
						{runs.length} {runs.length === 1 ? 'run' : 'runs'} in <MetadataTag title={repoRoot}>{repoRoot}</MetadataTag>
					</p>
					<Link to="/repo/runs" className="text-brand-to text-sm underline underline-offset-4">
						See the runs →
					</Link>
				</>
			)}
		</div>
	);
};
