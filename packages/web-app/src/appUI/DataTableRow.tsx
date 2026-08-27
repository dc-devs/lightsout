import { ChevronDown, ChevronRight } from 'lucide-react';
import { DataTableCell } from '#src/appUI/DataTableCell.tsx';
import type { DataTableColumn } from '#src/common/types/DataTableColumn.ts';
import { cn } from '#src/common/utils/cn.ts';

interface Props<TRow> {
	row: TRow;
	columns: Array<DataTableColumn<TRow>>;
	/** The table carries a disclosure column, so this row needs its leading cell whether or not it opens. */
	hasDisclosure?: boolean;
	isExpanded?: boolean;
	/** Given, the leading cell carries the chevron that opens this row. */
	onToggleExpanded?: () => void;
	className?: string;
}

/**
 * One `<tr>` of a data table: the disclosure cell, then one `<td>` per column.
 *
 * The leading cell is drawn for every row once the table has a disclosure
 * column, even for a row with nothing under it — otherwise the columns of the
 * rows that do open would sit one place to the right of the ones that do not.
 */
export const DataTableRow = <TRow,>({ row, columns, hasDisclosure = false, isExpanded = false, onToggleExpanded, className }: Props<TRow>) => {
	const Chevron = isExpanded ? ChevronDown : ChevronRight;

	return (
		<tr className={cn('border-border border-b last:border-0', className)}>
			{hasDisclosure ? (
				<DataTableCell className="w-8">
					{onToggleExpanded === undefined ? null : (
						<button
							type="button"
							aria-expanded={isExpanded}
							aria-label={isExpanded ? 'Collapse phases' : 'Expand phases'}
							onClick={onToggleExpanded}
							className="flex items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
						>
							<Chevron aria-hidden="true" className="size-4" />
						</button>
					)}
				</DataTableCell>
			) : null}
			{columns.map((column) => (
				<DataTableCell key={column.key} align={column.align} className={column.className}>
					{column.render(row)}
				</DataTableCell>
			))}
		</tr>
	);
};
