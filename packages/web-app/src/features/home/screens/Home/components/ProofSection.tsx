import type { RunListing } from '@lightsout/engine';
import { PipelineKind, RunStatus } from '@lightsout/engine/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { BrowserFrame, SectionHeader, Skeleton, Tabs } from '#src/appUI/index.ts';
import { repoRootQueryOptions } from '#src/features/app/index.ts';
import { DemoRunSlug } from '#src/lightsout/common/constants/DemoRunSlug.ts';
import { getDemoRunListings } from '#src/lightsout/common/utils/getDemoRunListings.ts';

/**
 * The frame's contents arrive as their own chunk.
 *
 * A quarter of a megabyte of frozen run detail has no business in the bundle
 * that paints the headline, and what it renders is the entire run detail page.
 * `DemoRunDetail` holds the mount flag that keeps this off the server render —
 * `React.lazy` alone would still run there.
 */
const DemoRunDetail = lazy(async () => ({ default: (await import('#src/features/home/components/DemoRunDetail.tsx')).DemoRunDetail }));

/** What each panel is showing, since a run's own title says nothing about why it is here. */
const panelLabels: Record<DemoRunSlug, string> = {
	[DemoRunSlug.Implement]: 'A clean run',
	[DemoRunSlug.Refactor]: 'A refactor burn-down',
	[DemoRunSlug.Stopped]: 'A run that stopped',
};

/**
 * Which frozen row fills each panel, by the three criteria
 * `scripts/freezeDemoRuns.mjs` picked the runs on.
 *
 * The rows arrive newest first, because that is the order the runs list wants
 * and the same file answers both. Matching on what each row IS keeps this
 * section from depending on where in that order a run happens to land.
 */
const slotPredicates: Record<DemoRunSlug, (listing: RunListing) => boolean> = {
	[DemoRunSlug.Implement]: (listing) => listing.pipeline === PipelineKind.Implement && listing.status === RunStatus.Passed,
	[DemoRunSlug.Refactor]: (listing) => listing.pipeline === PipelineKind.Refactor && listing.status === RunStatus.Passed,
	[DemoRunSlug.Stopped]: (listing) => listing.status === RunStatus.Failed || listing.status === RunStatus.Escalated,
};

/** One panel: browser chrome around the real run detail page, rendering a run that actually happened. */
const buildPanel = ({ slug, listing }: { slug: DemoRunSlug; listing: RunListing }) => ({
	value: slug,
	label: panelLabels[slug],
	content: (
		<BrowserFrame url={`lightsout.dev/repo/runs/${listing.shortId}`}>
			<Suspense fallback={<Skeleton className="h-96 w-full rounded-none" />}>
				<DemoRunDetail slug={slug} />
			</Suspense>
		</BrowserFrame>
	),
});

/**
 * The evidence three of this project's own runs left behind, shown inside the
 * real run detail page.
 *
 * The link under it is true in either zone: on a build with no repo the runs
 * table serves exactly these three runs, and on a local one it serves that
 * repo's own. The repo question is subscribed to rather than suspended on — a
 * label is not worth a boundary — so the public wording stands until it answers.
 */
export const ProofSection = () => {
	const listings = getDemoRunListings();
	const { data } = useQuery(repoRootQueryOptions());
	const panels = Object.values(DemoRunSlug).flatMap((slug) => {
		const listing = listings.find(slotPredicates[slug]);

		return listing === undefined ? [] : [buildPanel({ slug, listing })];
	});

	return (
		<section className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12 lg:px-10">
			<SectionHeader title="Proof" />
			<h2 className="max-w-3xl font-semibold text-2xl lg:text-3xl">The model can claim success. Lightsout requires evidence.</h2>
			<Tabs items={panels} defaultValue={DemoRunSlug.Implement} />
			<p className="text-muted-foreground text-sm">Every run leaves this behind.</p>
			<Link to="/repo/runs" className="text-brand-to text-sm underline underline-offset-4">
				{data?.repoRoot === undefined ? 'Browse lightsout’s own runs →' : 'Browse this repo’s runs →'}
			</Link>
		</section>
	);
};
