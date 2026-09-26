import { useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ScrollText } from 'lucide-react';
import { PageHeader } from '#src/appUI/headers/PageHeader.tsx';
import { SortDirection } from '#src/common/constants/SortDirection.ts';
import { formatCount } from '#src/common/formatting/formatCount.ts';
import { RunsSortKey } from '#src/features/runs/common/constants/RunsSortKey.ts';
import type { RunFilters } from '#src/features/runs/common/types/RunFilters.ts';
import { runsQueryOptions } from '#src/features/runs/queries/runsQueryOptions.ts';
import { RunsTable } from '#src/features/runs/screens/RunsPage/components/RunsTable.tsx';
import { RunsFilterBar } from '#src/features/runs/screens/RunsPage/internal/components/RunsFilterBar.tsx';

/** A sort key on its way into the URL, read back against the closed vocabulary the route validates it with. */
const readSortKey = ({ key }: { key?: string }) => Object.values(RunsSortKey).find((candidate) => candidate === key);

/**
 * Every run this repo has, as a table a reader can narrow and order.
 *
 * The filters live in the URL rather than in component state, so a narrowed
 * table is a link somebody can send. Every write replaces rather than pushes:
 * back should leave the runs page, not unwind one filter edit at a time.
 */
export const RunsPage = () => {
	const { data: runs } = useSuspenseQuery(runsQueryOptions());
	const search = useSearch({ from: '/app/runs' });
	const navigate = useNavigate({ from: '/app/runs' });
	const filters: RunFilters = {
		commands: search.commands ?? [],
		statuses: search.statuses ?? [],
		text: search.text,
		// Newest first until a reader says otherwise, and a URL naming a column the
		// table cannot order by reads as saying nothing.
		sortKey: search.sortKey ?? RunsSortKey.Updated,
		sortDirection: search.sortDirection ?? SortDirection.Descending,
	};
	const write = ({ next }: { next: RunFilters }) => {
		void navigate({
			search: {
				commands: next.commands.length === 0 ? undefined : next.commands,
				statuses: next.statuses.length === 0 ? undefined : next.statuses,
				text: next.text,
				sortKey: readSortKey({ key: next.sortKey }),
				sortDirection: next.sortDirection,
			},
			replace: true,
		});
	};

	return (
		<div className="flex flex-col gap-4 p-6">
			<PageHeader icon={ScrollText} title="Runs" description={formatCount({ count: runs.length, noun: 'run' })} />
			<RunsFilterBar runs={runs} filters={filters} onChange={(next) => write({ next })} />
			<RunsTable
				runs={runs}
				filters={filters}
				onSort={({ key, direction }) => write({ next: { ...filters, sortKey: key, sortDirection: direction } })}
				onClearFilters={() => write({ next: { commands: [], statuses: [], sortKey: filters.sortKey, sortDirection: filters.sortDirection } })}
			/>
		</div>
	);
};
