import type { StandardsPackFixture, StandardsPackRuleListing } from '@lightsout/engine';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge, MetadataTag, Skeleton } from '#src/appUI/index.ts';
import { severityBadgeVariants } from '#src/features/packs/common/constants/severityBadgeVariants.ts';
import { hasRuleFixtures } from '#src/features/packs/common/utils/hasRuleFixtures.ts';
import { FixtureDiff } from '#src/features/packs/components/FixtureDiff.tsx';
import { packRuleQueryOptions } from '#src/features/packs/queries/packRuleQueryOptions.ts';

/** What the row shows once it is open, given the state of the one fetch it makes. */
const RuleFixtures = ({ isPending, fixtures }: { isPending: boolean; fixtures?: StandardsPackFixture[] }) => {
	if (isPending) {
		return <Skeleton className="h-40 w-full" />;
	}

	return fixtures === undefined ? <p className="text-muted-foreground text-sm">Could not load this rule's fixtures.</p> : <FixtureDiff fixtures={fixtures} />;
};

interface Props {
	rule: StandardsPackRuleListing;
	packName: string;
}

/**
 * One rule in the list: what it catches, who enforces it, and — on expand — the
 * code that proves it.
 *
 * The fixture text is fetched the first time the row opens and never again, so
 * a page listing a hundred rules costs one small payload plus whatever a reader
 * actually opened. A rule the pack shipped without fixtures says so without
 * asking the server for text that is not there, and a row nobody opened draws
 * nothing at all.
 *
 * The id is a link to the rule's own page — two questions, two controls, on one
 * line.
 *
 * The browser owns the disclosure and React only listens: `toggle` fires however
 * a reader opened the row — pointer, keyboard, or find-in-page — so the fetch
 * waits on the element's own state rather than on a second copy of it.
 */
export const PackRuleRow = ({ rule, packName }: Props) => {
	const [open, setOpen] = useState(false);
	const hasFixtures = hasRuleFixtures({ rule });
	const { data, isPending } = useQuery({ ...packRuleQueryOptions({ name: packName, rule: rule.id }), enabled: open && hasFixtures });

	return (
		<details className="rounded-md border border-border bg-card" onToggle={(event) => setOpen(event.currentTarget.open)}>
			<summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2">
				<Link to="/standards/$pack/$rule" params={{ pack: packName, rule: rule.id }}>
					<MetadataTag className="hover:border-primary">{rule.id}</MetadataTag>
				</Link>
				<span className="min-w-0 flex-1 text-sm">{rule.summary}</span>
				<Badge>{rule.checked ? 'code' : 'judgment'}</Badge>
				<Badge variant={severityBadgeVariants[rule.defaultSeverity]}>{rule.defaultSeverity}</Badge>
			</summary>
			{open ? (
				<div className="border-border border-t px-3 py-3">
					{hasFixtures ? <RuleFixtures isPending={isPending} fixtures={data?.fixtures} /> : <FixtureDiff fixtures={[]} />}
				</div>
			) : null}
		</details>
	);
};
