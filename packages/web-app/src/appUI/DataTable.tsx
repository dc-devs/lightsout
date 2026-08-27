import { Fragment, type ReactNode } from 'react';
import { DataTableHeader } from '#src/appUI/DataTableHeader.tsx';
import { DataTableRow } from '#src/appUI/DataTableRow.tsx';
import { SortDirection } from '#src/common/constants/SortDirection.ts';
import type { DataTableColumn } from '#src/common/types/DataTableColumn.ts';
import { cn } from '#src/common/utils/cn.ts';

/** Two sort values of the same column, compared as the type they are. */
const compareValues = ({ first, second }: { first: string | number; second: string | number }) =>
	typeof first === 'number' && typeof second === 'number' ? first - second : String(first).localeCompare(String(second));

/** The rows in the active column's own order, or exactly as given when no sortable column is in charge. */
const orderRows = <TRow,>({
	rows,
	columns,
	sortKey,
	sortDirection,
}: {
	rows: TRow[];
	columns: Array<DataTableColumn<TRow>>;
	sortKey?: string;
	sortDirection?: SortDirection;
}) => {
	const sortValue = columns.find((column) => column.key === sortKey)?.sortValue;

	if (sortValue === undefined) {
		return rows;
	}

	const factor = sortDirection === SortDirection.Descending ? -1 : 1;

	return [...rows].sort((first, second) => factor * compareValues({ first: sortValue(first), second: sortValue(second) }));
};

interface Props<TRow> {
	rows: TRow[];
	columns: Array<DataTableColumn<TRow>>;
	getRowKey: (row: TRow) => string;
	sortKey?: string;
	sortDirection?: SortDirection;
	onSort?: (params: { key: string; direction: SortDirection }) => void;
	/** Rendered instead of the table when `rows` is empty. */
	empty?: ReactNode;
	/** Table rows rendered under a row when it is expanded; null for a row with nothing under it. */
	renderExpanded?: (row: TRow) => ReactNode;
	expandedKeys?: string[];
	onToggleExpanded?: (key: string) => void;
	className?: string;
}

/**
 * A real `<table>` inside its own scroll container, so a wide table scrolls
 * sideways rather than pushing the page sideways with it.
 *
 * Sorting is held by the caller — every consumer keeps it in the URL — but
 * applied here, by the active column's own `sortValue`. That way a column says
 * once how it sorts and no page writes a comparator. Consumers filter; the
 * table orders.
 */
export const DataTable = <TRow,>({
	rows,
	columns,
	getRowKey,
	sortKey,
	sortDirection,
	onSort,
	empty,
	renderExpanded,
	expandedKeys = [],
	onToggleExpanded,
	className,
}: Props<TRow>) => {
	const hasDisclosure = renderExpanded !== undefined && onToggleExpanded !== undefined;

	return (
		<div className={cn('w-full overflow-x-auto rounded-lg border border-border bg-card', className)}>
			{rows.length === 0 && empty !== undefined ? (
				empty
			) : (
				<table className="w-full min-w-max border-collapse text-left text-sm">
					<DataTableHeader columns={columns} sortKey={sortKey} sortDirection={sortDirection} onSort={onSort} hasDisclosure={hasDisclosure} />
					<tbody>
						{orderRows({ rows, columns, sortKey, sortDirection }).map((row) => {
							const key = getRowKey(row);
							const expanded = renderExpanded?.(row);
							const isExpanded = expandedKeys.includes(key);
							// A row the caller returned nothing for has nothing to open, so it
							// keeps its leading cell and loses only the chevron.
							const canOpen = hasDisclosure && expanded !== null && expanded !== undefined;

							return (
								<Fragment key={key}>
									<DataTableRow
										row={row}
										columns={columns}
										hasDisclosure={hasDisclosure}
										isExpanded={isExpanded}
										onToggleExpanded={canOpen ? () => onToggleExpanded?.(key) : undefined}
									/>
									{isExpanded ? expanded : null}
								</Fragment>
							);
						})}
					</tbody>
				</table>
			)}
		</div>
	);
};
