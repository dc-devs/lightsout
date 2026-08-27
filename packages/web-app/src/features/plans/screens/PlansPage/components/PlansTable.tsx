import type { PlanWorkspaceListing } from '@lightsout/engine';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { DataTable, StatusBadge } from '#src/appUI/index.ts';
import { SortDirection } from '#src/common/constants/SortDirection.ts';
import { TableAlignment } from '#src/common/constants/TableAlignment.ts';
import { formatRelativeTime } from '#src/common/formatting/formatRelativeTime.ts';
import type { DataTableColumn } from '#src/common/types/DataTableColumn.ts';
import { planGradeBadgeConfig } from '#src/features/plans/common/constants/planGradeBadgeConfig.ts';
import { planStageBadgeConfig } from '#src/features/plans/common/constants/planStageBadgeConfig.ts';

/** The column a plans list opens on: what happened most recently is what a reader is looking for. */
const defaultSortKey = 'updatedAt';

/** The workspace's name, as the way into what it decided. */
const PlanLink = ({ listing }: { listing: PlanWorkspaceListing }) => (
	<Link to="/repo/plans/$name" params={{ name: listing.name }} className="font-medium hover:underline hover:underline-offset-2">
		{listing.name}
	</Link>
);

/** The columns, in the order a reader scans them: what it is, how far it got, how big it is, when. */
const columns: Array<DataTableColumn<PlanWorkspaceListing>> = [
	{ key: 'name', header: 'plan', sortValue: (listing) => listing.name, render: (listing) => <PlanLink listing={listing} /> },
	{
		key: 'stage',
		header: 'stage',
		sortValue: (listing) => listing.stage,
		render: (listing) => <StatusBadge status={listing.stage} config={planStageBadgeConfig} />,
	},
	{
		key: 'grade',
		header: 'grade',
		sortValue: (listing) => listing.grade ?? '',
		render: (listing) => (listing.grade === undefined ? '—' : <StatusBadge status={listing.grade} config={planGradeBadgeConfig} />),
	},
	{
		key: 'phases',
		header: 'phases',
		align: TableAlignment.Right,
		sortValue: (listing) => listing.phaseCount,
		// A single plan has no phases to count, and a dash says that rather than
		// claiming it has zero of something it never had.
		render: (listing) => (listing.phased ? listing.phaseCount : '—'),
	},
	{ key: 'runs', header: 'runs', align: TableAlignment.Right, sortValue: (listing) => listing.runCount, render: (listing) => listing.runCount },
	{
		key: defaultSortKey,
		header: 'updated',
		sortValue: (listing) => listing.updatedAt,
		render: (listing) => <span className="whitespace-nowrap text-muted-foreground">{formatRelativeTime({ at: listing.updatedAt })}</span>,
	},
];

interface Props {
	listings: PlanWorkspaceListing[];
	/** What the table says when `listings` is empty. Each consumer knows why its own list is empty; the table does not. */
	empty: ReactNode;
}

/**
 * Every plan workspace a caller hands over, as rows a reader can order.
 *
 * Split out of the page the way `RunsTable` is, so the commands feature can show
 * the same rows filtered to one command's own workspaces.
 *
 * The ordering is this table's own rather than the URL's: the plans page keeps
 * only its stage filter in the query string, and a shared table cannot write to
 * a route it does not know it is on.
 */
export const PlansTable = ({ listings, empty }: Props) => {
	const [sort, setSort] = useState<{ key: string; direction: SortDirection }>({ key: defaultSortKey, direction: SortDirection.Descending });

	return (
		<DataTable
			rows={listings}
			columns={columns}
			getRowKey={(listing) => listing.name}
			sortKey={sort.key}
			sortDirection={sort.direction}
			onSort={({ key, direction }) => setSort({ key, direction })}
			empty={empty}
		/>
	);
};
