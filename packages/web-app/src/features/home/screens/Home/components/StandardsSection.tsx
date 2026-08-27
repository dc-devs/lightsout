import type { StandardsPackListing } from '@lightsout/engine';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { MetadataTag, SectionHeader, Skeleton } from '#src/appUI/index.ts';
import { FixtureDiff, packRuleQueryOptions, packsQueryOptions, showcaseRuleIds } from '#src/features/packs/index.ts';

/**
 * One showcased rule: what it argues, over the code it is arguing about.
 *
 * Its own query rather than the pack whole, because a pack's fixture text runs
 * to megabytes and this page shows three rules' worth. A fetch that fails takes
 * the card out rather than the page — a rule renamed since this list was written
 * must not cost a reader the section.
 */
const ShowcaseRule = ({ packName, rule }: { packName: string; rule: string }) => {
	const { data, isPending } = useQuery(packRuleQueryOptions({ name: packName, rule }));

	if (isPending) {
		return (
			<div className="flex flex-col gap-2">
				<Skeleton className="h-4 w-64" />
				<Skeleton className="h-40 w-full" />
			</div>
		);
	}

	return data === undefined ? null : (
		<div className="flex min-w-0 flex-col gap-2">
			<div className="flex flex-wrap items-baseline gap-2">
				<MetadataTag>{data.id}</MetadataTag>
				<p className="text-sm">{data.summary}</p>
				<Link to="/standards/$pack/$rule" params={{ pack: packName, rule: data.id }} className="text-brand-to text-xs underline underline-offset-4">
					Read the rule →
				</Link>
			</div>
			<FixtureDiff fixtures={data.fixtures} />
		</div>
	);
};

/** The default pack's three numbers and the three rules that show what they buy. */
const DefaultPackProof = ({ pack }: { pack: StandardsPackListing }) => {
	// Three reads as a taste; the pack page shows the rest.
	const showcaseCount = 3;

	return (
		<>
			<p className="text-muted-foreground-strong text-sm">
				{pack.totals.rules} rules · {pack.totals.checked} enforced by code · {pack.totals.withFixtures} with a pass and a fail example
			</p>
			{showcaseRuleIds.slice(0, showcaseCount).map((rule) => (
				<ShowcaseRule key={rule} packName={pack.name} rule={rule} />
			))}
		</>
	);
};

/**
 * That the rules are yours to change, and what they look like when they are not.
 *
 * The numbers are read live rather than typed into the copy, and the query is
 * deliberately not a suspending one: a pack that will not load leaves the prose
 * standing instead of taking Home down. A repo whose config names its own packs
 * has no default entry at all, so the numbers and the three cards simply do not
 * render — the argument does not depend on them.
 */
export const StandardsSection = () => {
	const { data: packs } = useQuery(packsQueryOptions());
	const defaultPack = packs?.find((pack) => pack.isDefault);

	return (
		<section className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12 lg:px-10">
			<SectionHeader title="Bring your own standards" />
			<h2 className="max-w-3xl font-semibold text-2xl lg:text-3xl">Ship with ours. Mix in yours.</h2>
			<p className="max-w-3xl text-muted-foreground-strong">
				A standards pack is a folder: each rule is its prose, a check when code can decide it, and a pass/fail example that proves the check. Stack your house
				rules on the default pack, turn any rule down to advisory or off per repo, and the agents write to{' '}
				<strong className="font-medium text-foreground">your</strong> style instead of whatever they found nearby.
			</p>
			{defaultPack === undefined ? null : <DefaultPackProof pack={defaultPack} />}
			<p className="text-muted-foreground text-xs">React and TanStack rules switch on automatically when those frameworks are detected.</p>
		</section>
	);
};
