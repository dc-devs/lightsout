import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { MetadataTag, PageHeader } from '#src/appUI/index.ts';
import { repoRootQueryOptions } from '#src/features/app/index.ts';
import { frictionQueryOptions } from '#src/features/friction/index.ts';
import { HealthTiles } from '#src/features/repo/screens/RepoHealth/components/HealthTiles.tsx';
import { NeedsYouPanel } from '#src/features/repo/screens/RepoHealth/components/NeedsYouPanel.tsx';
import { RecentRuns } from '#src/features/repo/screens/RepoHealth/components/RecentRuns.tsx';
import { RepoStrip } from '#src/features/repo/screens/RepoHealth/components/RepoStrip.tsx';
import { TopRulesPanel } from '#src/features/repo/screens/RepoHealth/components/TopRulesPanel.tsx';
import { runsQueryOptions } from '#src/features/runs/index.ts';
import { standardsQueryOptions } from '#src/features/standards/index.ts';

/**
 * What a deployment with no repository under it says here.
 *
 * Health is about one repository, and drawn over the public build's three frozen
 * demo runs it would be fiction — so the pane the zone landed on before this
 * page existed is what it keeps saying.
 */
const NoRepoFound = () => (
	<div className="flex h-full flex-col items-start justify-center gap-2 p-10">
		<h1 className="font-semibold text-lg">Your repo</h1>
		<p className="text-muted-foreground text-sm">
			No lightsout repo found above this directory — set <MetadataTag>LIGHTSOUT_REPO</MetadataTag> or run from inside one.
		</p>
	</div>
);

/**
 * Does anything need me right now, and what is this repo doing?
 *
 * Suspends on the runs alone. The standards check and the friction log are
 * things a repo may never have produced, and a landing page that waited on
 * either would show nothing at all to the repo that most needs telling how to
 * start. Both arrive through `useQuery`, and the surfaces that read them are
 * simply not mounted until they do.
 *
 * Every run count on the page is top-level runs only — one eight-phase implement
 * run is one thing that happened. `HealthTiles` gets the unfiltered list because
 * its spend tile is the one number that must include the phase children.
 */
export const RepoHealth = () => {
	const {
		data: { repoRoot },
	} = useSuspenseQuery(repoRootQueryOptions());
	const { data: runs } = useSuspenseQuery(runsQueryOptions());
	const { data: standards } = useQuery(standardsQueryOptions());
	const { data: friction } = useQuery(frictionQueryOptions());

	if (repoRoot === undefined) {
		return <NoRepoFound />;
	}

	const topLevel = [...runs.filter((run) => run.parentRunId === undefined)].sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));

	return (
		<div className="flex flex-col gap-4 p-6">
			<PageHeader icon={Activity} title="Health" description={<RepoStrip runs={topLevel} />} />
			<NeedsYouPanel runs={topLevel} />
			<HealthTiles runs={runs} standards={standards} friction={friction} />
			<div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_22rem]">
				<RecentRuns runs={topLevel} />
				{standards === undefined ? null : <TopRulesPanel rules={standards.rules} />}
			</div>
		</div>
	);
};
