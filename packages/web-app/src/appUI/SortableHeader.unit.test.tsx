import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { SortableHeader } from '#src/appUI/SortableHeader.tsx';
import { SortDirection } from '#src/common/constants/SortDirection.ts';

const setupHeader = ({ activeKey, direction }: { activeKey?: string; direction?: SortDirection } = {}) => {
	const onSort = jest.fn<(params: { key: string; direction: SortDirection }) => void>();

	render(<SortableHeader label="updated" sortKey="updatedAt" activeKey={activeKey} direction={direction} onSort={onSort} />);

	return { onSort, press: () => fireEvent.click(screen.getByRole('button', { name: /updated/ })) };
};

describe('SortableHeader', () => {
	test('starts a column that was not in charge ascending', () => {
		const { onSort, press } = setupHeader();

		press();

		expect(onSort).toHaveBeenCalledWith({ key: 'updatedAt', direction: SortDirection.Ascending });
	});

	test('flips the column already in charge', () => {
		const { onSort, press } = setupHeader({ activeKey: 'updatedAt', direction: SortDirection.Ascending });

		press();

		expect(onSort).toHaveBeenCalledWith({ key: 'updatedAt', direction: SortDirection.Descending });
	});

	test('flips it back the other way', () => {
		const { onSort, press } = setupHeader({ activeKey: 'updatedAt', direction: SortDirection.Descending });

		press();

		expect(onSort).toHaveBeenCalledWith({ key: 'updatedAt', direction: SortDirection.Ascending });
	});

	test('shows which way it runs only on the column that is in charge', () => {
		setupHeader({ activeKey: 'title', direction: SortDirection.Ascending });

		// the indicator is the whole signal, so an inactive column drawing one would
		// claim an order the table is not in
		expect(screen.getByRole('button').querySelector('svg')).toBeNull();
	});

	test('draws the indicator once the column is in charge', () => {
		setupHeader({ activeKey: 'updatedAt', direction: SortDirection.Descending });

		expect(screen.getByRole('button').querySelector('svg')).not.toBeNull();
	});
});
