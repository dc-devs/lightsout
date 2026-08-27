import type { StandardsPackListing } from '@lightsout/engine';
import { Link } from '@tanstack/react-router';
import { Badge, Card, MetadataTag } from '#src/appUI/index.ts';
import { BadgeVariant } from '#src/common/constants/BadgeVariant.ts';

interface Props {
	pack: StandardsPackListing;
}

/**
 * One standards pack on the packs list: what it is called, what it says about
 * itself, how much of it there is, and which repos it applies to.
 *
 * Four of the five totals are shown. `judgment` is left off because it is
 * `rules` minus `checked` — a fifth number that adds nothing a reader cannot
 * already see, on a card whose job is to be scanned.
 *
 * The name is the way in to the pack's own page, which is where its rules, its
 * caps and the code behind them are.
 */
export const PackCard = ({ pack }: Props) => {
	const counts: [string, number][] = [
		['rules', pack.totals.rules],
		['checked by code', pack.totals.checked],
		['documents', pack.totals.documents],
		['with examples', pack.totals.withFixtures],
	];

	return (
		<Card>
			<div className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center gap-2">
					<h2 className="font-semibold text-base">
						<Link to="/standards/$pack" params={{ pack: pack.name }} className="transition-colors hover:text-brand-to">
							{pack.name}
						</Link>
					</h2>
					{pack.isDefault ? <Badge variant={BadgeVariant.Brand}>default — loads when you say nothing</Badge> : null}
					{/* The one place the list says why "with examples" reads zero on
					    every repo that is not the one the pack was authored in. */}
					{pack.built ? <Badge>shipped without its fixtures</Badge> : null}
				</div>
				{pack.description === undefined ? null : <p className="text-muted-foreground text-sm">{pack.description}</p>}
				<dl className="flex flex-wrap gap-x-6 gap-y-1">
					{counts.map(([label, value]) => (
						<div key={label} className="flex items-baseline gap-1.5">
							<dt className="order-2 text-muted-foreground text-xs">{label}</dt>
							<dd className="font-semibold text-sm tabular-nums">{value}</dd>
						</div>
					))}
				</dl>
				<div className="flex flex-wrap gap-1">
					{pack.channels.map((channel) => (
						<MetadataTag key={channel}>{channel}</MetadataTag>
					))}
				</div>
			</div>
		</Card>
	);
};
