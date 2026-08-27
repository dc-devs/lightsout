import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { DataTableRow } from '#src/appUI/DataTableRow.tsx';
import type { DataTableColumn } from '#src/common/types/DataTableColumn.ts';

interface Row {
	title: string;
	cost: string;
}

const columns: Array<DataTableColumn<Row>> = [
	{ key: 'title', header: 'title', render: (row) => row.title },
	{ key: 'cost', header: 'cost', className: 'font-mono', render: (row) => row.cost },
];

const setupRow = ({ hasDisclosure, isExpanded, withToggle }: { hasDisclosure?: boolean; isExpanded?: boolean; withToggle?: boolean } = {}) => {
	const onToggleExpanded = jest.fn<() => void>();

	render(
		<table>
			<tbody>
				<DataTableRow
					row={{ title: 'add search', cost: '$12.80' }}
					columns={columns}
					hasDisclosure={hasDisclosure}
					isExpanded={isExpanded}
					onToggleExpanded={withToggle ? onToggleExpanded : undefined}
				/>
			</tbody>
		</table>,
	);

	return { onToggleExpanded };
};

describe('DataTableRow', () => {
	test('draws one body cell per column, in the order the columns were given', () => {
		setupRow();

		expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toStrictEqual(['add search', '$12.80']);
	});

	test('keeps its leading cell even with nothing under it to open, so the columns stay lined up', () => {
		setupRow({ hasDisclosure: true });

		expect(screen.getAllByRole('cell')).toHaveLength(3);
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

	test('offers the chevron once there is something under the row', () => {
		const { onToggleExpanded } = setupRow({ hasDisclosure: true, withToggle: true });

		fireEvent.click(screen.getByRole('button', { name: 'Expand phases' }));

		expect(onToggleExpanded).toHaveBeenCalledTimes(1);
	});

	test('says it is open once it is, and offers the way back', () => {
		setupRow({ hasDisclosure: true, withToggle: true, isExpanded: true });

		expect(screen.getByRole('button', { name: 'Collapse phases' })).toHaveAttribute('aria-expanded', 'true');
	});

	test('carries the classes a column asked for onto its cell', () => {
		setupRow();

		expect(screen.getByRole('cell', { name: '$12.80' }).className).toContain('font-mono');
	});
});
