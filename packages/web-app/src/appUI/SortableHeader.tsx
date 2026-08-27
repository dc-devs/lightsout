import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { SortDirection } from '#src/common/constants/SortDirection.ts';

interface Props {
	label: ReactNode;
	sortKey: string;
	/** The column the table is ordered by right now. */
	activeKey?: string;
	direction?: SortDirection;
	onSort: (params: { key: string; direction: SortDirection }) => void;
}

/**
 * The control inside a sortable column's header cell.
 *
 * Pressing the column already in charge flips its direction; pressing any other
 * starts it ascending, which is what a reader means by "sort by this one".
 * `aria-sort` belongs on the owning `<th>`, so this draws the button alone.
 */
export const SortableHeader = ({ label, sortKey, activeKey, direction, onSort }: Props) => {
	const isActive = activeKey === sortKey;
	const next = isActive && direction === SortDirection.Ascending ? SortDirection.Descending : SortDirection.Ascending;
	const Indicator = direction === SortDirection.Descending ? ChevronDown : ChevronUp;

	return (
		<button
			type="button"
			onClick={() => onSort({ key: sortKey, direction: next })}
			className="inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground"
		>
			{label}
			{isActive ? <Indicator aria-hidden="true" className="size-3.5" /> : null}
		</button>
	);
};
