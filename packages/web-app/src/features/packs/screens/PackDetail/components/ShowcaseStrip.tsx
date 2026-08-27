import type { StandardsPackRuleListing } from '@lightsout/engine';
import { useQuery } from '@tanstack/react-query';
import { MetadataTag, SectionHeader, Skeleton } from '#src/appUI/index.ts';
import { showcaseRuleIds } from '#src/features/packs/common/constants/showcaseRuleIds.ts';
import { hasPackFixtures } from '#src/features/packs/common/utils/hasPackFixtures.ts';
import { FixtureDiff } from '#src/features/packs/components/FixtureDiff.tsx';
import { packRuleQueryOptions } from '#src/features/packs/queries/packRuleQueryOptions.ts';

/**
 * One showcased rule: what it says, over the code it is arguing about.
 *
 * A fetch that fails takes this entry out of the strip rather than the page out
 * of the reader's hands — the route's loader warmed six of these, and one rule
 * renamed since the link was written must not 404 a pack.
 */
const ShowcaseRule = ({ packName, rule }: { packName: string; rule: StandardsPackRuleListing }) => {
	const { data, isPending } = useQuery(packRuleQueryOptions({ name: packName, rule: rule.id }));

	if (isPending) {
		return (
			<div className="flex flex-col gap-2">
				<Skeleton className="h-4 w-64" />
				<Skeleton className="h-40 w-full" />
			</div>
		);
	}

	return data === undefined ? null : (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-baseline gap-2">
				<MetadataTag>{rule.id}</MetadataTag>
				<p className="text-sm">{rule.summary}</p>
			</div>
			<FixtureDiff fixtures={data.fixtures} />
		</div>
	);
};

interface Props {
	packName: string;
	rules: StandardsPackRuleListing[];
}

/**
 * Six rules that read in five lines each, as the pack's opening argument.
 *
 * The six are a constant rather than a sample, so the strip says the same thing
 * every time it is opened. An id the pack no longer carries is skipped in
 * silence; a pack that matches none of them, or one whose fixtures were
 * stripped, renders nothing at all — a heading over an empty strip would claim
 * a showcase this page cannot give.
 */
export const ShowcaseStrip = ({ packName, rules }: Props) => {
	const showcase = showcaseRuleIds.flatMap((id) => {
		const rule = rules.find((candidate) => candidate.id === id);

		return rule === undefined ? [] : [rule];
	});

	return showcase.length === 0 || !hasPackFixtures({ rules }) ? null : (
		<section aria-label="What the code looks like" className="flex flex-col gap-4">
			<SectionHeader title="What the code looks like" description="Every rule that can be decided mechanically ships the pair of examples that decides it." />
			{showcase.map((rule) => (
				<ShowcaseRule key={rule.id} packName={packName} rule={rule} />
			))}
		</section>
	);
};
