import { describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { DataTableHeader } from '#src/appUI/DataTableHeader.tsx';
import { SortDirection } from '#src/common/constants/SortDirection.ts';
import { TableAlignment } from '#src/common/constants/TableAlignment.ts';
import type { DataTableColumn } from '#src/common/types/DataTableColumn.ts';

interface Row {
	title: string;
	cost: number;
}

const columns: Array<DataTableColumn<Row>> = [
	{ key: 'title', header: 'title', render: (row) => row.title },
	{ key: 'cost', header: 'cost', align: TableAlignment.Right, sortValue: (row) => row.cost, render: (row) => row.cost },
];

const setupHeader = ({
	sortKey,
	sortDirection,
	withSort = true,
	hasDisclosure,
}: {
	sortKey?: string;
	sortDirection?: SortDirection;
	withSort?: boolean;
	hasDisclosure?: boolean;
} = {}) => {
	const onSort = jest.fn<(params: { key: string; direction: SortDirection }) => void>();

	render(
		<table>
			<DataTableHeader columns={columns} sortKey={sortKey} sortDirection={sortDirection} onSort={withSort ? onSort : undefined} hasDisclosure={hasDisclosure} />
		</table>,
	);

	return { onSort };
};

describe('DataTableHeader', () => {
	test('gives every column a header cell, and only header cells', () => {
		setupHeader();

		expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toStrictEqual(['title', 'cost']);
	});

	test('adds the blank leading cell when the table carries a disclosure column', () => {
		setupHeader({ hasDisclosure: true });

		// the rows that open sit one cell to the right, so the header has to as well
		expect(screen.getAllByRole('columnheader')).toHaveLength(3);
	});

	test('makes only the columns that said how they sort pressable', () => {
		setupHeader();

		expect(screen.getAllByRole('button').map((button) => button.textContent)).toStrictEqual(['cost']);
	});

	test('leaves every column plain when the table is not sortable at all', () => {
		setupHeader({ withSort: false });

		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

	test.each([
		{ sortDirection: SortDirection.Ascending, sort: 'ascending' },
		{ sortDirection: SortDirection.Descending, sort: 'descending' },
	])('tells assistive tech the active column runs $sort', ({ sortDirection, sort }) => {
		setupHeader({ sortKey: 'cost', sortDirection });

		expect(screen.getByRole('columnheader', { name: 'cost' })).toHaveAttribute('aria-sort', sort);
	});

	test('claims no order for a sortable column that is not the active one, and none at all for an unsortable one', () => {
		setupHeader({ sortKey: 'title' });

		expect(screen.getByRole('columnheader', { name: 'cost' })).toHaveAttribute('aria-sort', 'none');
		expect(screen.getByRole('columnheader', { name: 'title' })).not.toHaveAttribute('aria-sort');
	});

	test('carries the alignment each column asked for', () => {
		setupHeader();

		expect(screen.getByRole('columnheader', { name: 'cost' }).className).toContain('text-right');
	});
});
