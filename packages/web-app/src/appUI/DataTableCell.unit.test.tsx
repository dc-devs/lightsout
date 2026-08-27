import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { DataTableCell } from '#src/appUI/DataTableCell.tsx';
import { TableAlignment } from '#src/common/constants/TableAlignment.ts';

const setupCell = ({ align, className }: { align?: TableAlignment; className?: string } = {}) => {
	render(
		<table>
			<tbody>
				<tr>
					<DataTableCell align={align} className={className}>
						$12.80
					</DataTableCell>
				</tr>
			</tbody>
		</table>,
	);

	return { cell: screen.getByRole('cell') };
};

describe('DataTableCell', () => {
	test('is a body cell rather than a header one, whatever it holds', () => {
		const { cell } = setupCell();

		expect(cell.tagName).toBe('TD');
	});

	test('reads left when the column said nothing about alignment', () => {
		const { cell } = setupCell();

		expect(cell.className).toContain('text-left');
	});

	test.each([
		{ align: TableAlignment.Center, token: 'text-center' },
		{ align: TableAlignment.Right, token: 'text-right' },
	])('sits against the $align edge when the column asked for it', ({ align, token }) => {
		const { cell } = setupCell({ align });

		expect(cell.className).toContain(token);
	});

	test('keeps the column’s own classes beside its alignment', () => {
		const { cell } = setupCell({ className: 'w-8' });

		expect(cell.className).toContain('w-8');
	});
});
