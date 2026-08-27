import type { ReactNode } from 'react';
import type { TableAlignment } from '#src/common/constants/TableAlignment.ts';

/**
 * One column of a data table: what it is called, what it draws, and — when it
 * is sortable at all — the value it sorts on.
 *
 * `sortValue` is the one place a column says how it sorts, so the table orders
 * the rows it is handed rather than every consumer writing a comparator.
 */
export interface DataTableColumn<TRow> {
	/** Stable key; also the sort key a sortable header emits. */
	key: string;
	header: ReactNode;
	align?: TableAlignment;
	/** Omitted, the column is not sortable. */
	sortValue?: (row: TRow) => string | number;
	render: (row: TRow) => ReactNode;
	className?: string;
}
