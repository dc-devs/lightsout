import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { DataTable } from '#src/appUI/DataTable.tsx';
import { DataTableRow } from '#src/appUI/DataTableRow.tsx';
import { EmptyState } from '#src/appUI/EmptyState.tsx';
import { SortDirection } from '#src/common/constants/SortDirection.ts';
import type { DataTableColumn } from '#src/common/types/DataTableColumn.ts';

interface Row {
	id: string;
	title: string;
	cost: number;
	children: Row[];
}

const columns: Array<DataTableColumn<Row>> = [
	{ key: 'title', header: 'title', sortValue: (row) => row.title, render: (row) => row.title },
	{ key: 'cost', header: 'cost', sortValue: (row) => row.cost, render: (row) => row.cost },
	{ key: 'plan', header: 'plan', render: () => 'plan.md' },
];

const buildRow = ({ id, title, cost = 1, children = [] }: { id: string; title: string; cost?: number; children?: Row[] }): Row => ({
	id,
	title,
	cost,
	children,
});

const rows = [buildRow({ id: 'b', title: 'beta', cost: 30 }), buildRow({ id: 'a', title: 'alpha', cost: 10 }), buildRow({ id: 'c', title: 'gamma', cost: 20 })];

const setupTable = ({
	tableRows = rows,
	sortKey,
	sortDirection,
	expandedKeys,
	withDisclosure = false,
	withEmpty = false,
}: {
	tableRows?: Row[];
	sortKey?: string;
	sortDirection?: SortDirection;
	expandedKeys?: string[];
	withDisclosure?: boolean;
	withEmpty?: boolean;
} = {}) => {
	const onSort = jest.fn<(params: { key: string; direction: SortDirection }) => void>();
	const onToggleExpanded = jest.fn<(key: string) => void>();

	render(
		<DataTable
			rows={tableRows}
			columns={columns}
			getRowKey={(row) => row.id}
			sortKey={sortKey}
			sortDirection={sortDirection}
			onSort={onSort}
			empty={withEmpty ? <EmptyState title="No rows yet." /> : undefined}
			expandedKeys={expandedKeys}
			onToggleExpanded={withDisclosure ? onToggleExpanded : undefined}
			renderExpanded={
				withDisclosure
					? (row) =>
							row.children.length === 0 ? null : row.children.map((child) => <DataTableRow key={child.id} row={child} columns={columns} hasDisclosure />)
					: undefined
			}
		/>,
	);

	return { onSort, onToggleExpanded };
};

/**
 * Every body row's title cell, in the order the table drew them. A table with a
 * disclosure column puts the chevron cell first, so the title moves along one.
 */
const readTitles = ({ offset = 0 }: { offset?: number } = {}) =>
	screen
		.getAllByRole('row')
		.slice(1)
		.map((row) => row.querySelectorAll('td')[offset]?.textContent);

describe('DataTable', () => {
	test('draws the rows exactly as given when no sortable column is in charge', () => {
		setupTable();

		expect(readTitles()).toStrictEqual(['beta', 'alpha', 'gamma']);
	});

	test('orders by the active column’s own sort value', () => {
		setupTable({ sortKey: 'title', sortDirection: SortDirection.Ascending });

		expect(readTitles()).toStrictEqual(['alpha', 'beta', 'gamma']);
	});

	test('runs the other way when the column says so', () => {
		setupTable({ sortKey: 'title', sortDirection: SortDirection.Descending });

		expect(readTitles()).toStrictEqual(['gamma', 'beta', 'alpha']);
	});

	test('compares numbers as numbers rather than as their spelling', () => {
		setupTable({ sortKey: 'cost', sortDirection: SortDirection.Ascending });

		// '10' sorts before '30' either way; '20' between them only numerically
		expect(readTitles()).toStrictEqual(['alpha', 'gamma', 'beta']);
	});

	test('leaves the order alone when the key names a column that says nothing about sorting', () => {
		setupTable({ sortKey: 'plan', sortDirection: SortDirection.Ascending });

		expect(readTitles()).toStrictEqual(['beta', 'alpha', 'gamma']);
	});

	test('reports a header press to the caller that holds the order', () => {
		const { onSort } = setupTable();

		fireEvent.click(screen.getByRole('button', { name: 'title' }));

		expect(onSort).toHaveBeenCalledWith({ key: 'title', direction: SortDirection.Ascending });
	});

	test('shows the empty state instead of a headed table with nothing under it', () => {
		setupTable({ tableRows: [], withEmpty: true });

		expect(screen.getByText('No rows yet.')).toBeInTheDocument();
		expect(screen.queryByRole('table')).not.toBeInTheDocument();
	});

	test('keeps the headed table when there is nothing to say about having no rows', () => {
		setupTable({ tableRows: [] });

		// a consumer that named no empty state still gets its columns, rather than
		// a bordered box with nothing in it at all
		expect(screen.getByRole('table')).toBeInTheDocument();
		expect(screen.getAllByRole('row')).toHaveLength(1);
	});

	test('offers the chevron only on the rows that have something under them', () => {
		const parent = buildRow({ id: 'p', title: 'parent', children: [buildRow({ id: 'k', title: 'kid' })] });

		setupTable({ tableRows: [parent, buildRow({ id: 'l', title: 'lone' })], withDisclosure: true });

		expect(screen.getAllByRole('button', { name: /phases/ })).toHaveLength(1);
	});

	test('keeps the children out of the table until the row is opened', () => {
		const parent = buildRow({ id: 'p', title: 'parent', children: [buildRow({ id: 'k', title: 'kid' })] });

		setupTable({ tableRows: [parent], withDisclosure: true });

		expect(readTitles({ offset: 1 })).toStrictEqual(['parent']);
	});

	test('draws the children beneath their coordinator once it is open', () => {
		const parent = buildRow({ id: 'p', title: 'parent', children: [buildRow({ id: 'k', title: 'kid' })] });

		setupTable({ tableRows: [parent], withDisclosure: true, expandedKeys: ['p'] });

		expect(readTitles({ offset: 1 })).toStrictEqual(['parent', 'kid']);
	});

	test('reports which row a reader asked to open', () => {
		const parent = buildRow({ id: 'p', title: 'parent', children: [buildRow({ id: 'k', title: 'kid' })] });
		const { onToggleExpanded } = setupTable({ tableRows: [parent], withDisclosure: true });

		fireEvent.click(screen.getByRole('button', { name: 'Expand phases' }));

		expect(onToggleExpanded).toHaveBeenCalledWith('p');
	});
});
