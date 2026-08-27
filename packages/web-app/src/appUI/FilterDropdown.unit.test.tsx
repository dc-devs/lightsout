import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { FilterDropdown } from '#src/appUI/FilterDropdown.tsx';

const countedOptions = [
	{ value: 'implement', label: 'implement', count: 12 },
	{ value: 'refactor', label: 'refactor', count: 3 },
];

const setupDropdown = ({
	selected = [],
	multiple,
	options = countedOptions,
}: {
	selected?: string[];
	multiple?: boolean;
	options?: Array<{ value: string; label: string; count?: number }>;
} = {}) => {
	const onChange = jest.fn<(selected: string[]) => void>();

	render(<FilterDropdown label="command" options={options} selected={selected} onChange={onChange} multiple={multiple} />);

	return {
		onChange,
		open: () => fireEvent.click(screen.getByRole('button', { name: /command/ })),
		choose: ({ name }: { name: RegExp }) => fireEvent.click(screen.getByRole('checkbox', { name })),
	};
};

describe('FilterDropdown', () => {
	test('shows nothing but its name until a reader opens it', () => {
		setupDropdown();

		expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
	});

	test('lists every value with how many rows carry it', () => {
		const { open } = setupDropdown();

		open();

		expect(screen.getByRole('checkbox', { name: /implement/ })).toHaveTextContent('12');
	});

	test('adds a value a reader picked', () => {
		const { onChange, open, choose } = setupDropdown();

		open();
		choose({ name: /refactor/ });

		expect(onChange).toHaveBeenCalledWith(['refactor']);
	});

	test('keeps the values already picked, since a filter narrows to a set', () => {
		const { onChange, open, choose } = setupDropdown({ selected: ['implement'] });

		open();
		choose({ name: /refactor/ });

		expect(onChange).toHaveBeenCalledWith(['implement', 'refactor']);
	});

	test('clears a value that was already picked, so every selection has a way back', () => {
		const { onChange, open, choose } = setupDropdown({ selected: ['implement', 'refactor'] });

		open();
		choose({ name: /implement/ });

		expect(onChange).toHaveBeenCalledWith(['refactor']);
	});

	test('collapses to the one value when the caller asked for a single choice', () => {
		const { onChange, open, choose } = setupDropdown({ selected: ['implement'], multiple: false });

		open();
		choose({ name: /refactor/ });

		expect(onChange).toHaveBeenCalledWith(['refactor']);
	});

	test('shows a value on its own when the caller counted no rows for it', () => {
		const { open } = setupDropdown({ options: [{ value: 'coverage', label: 'coverage' }] });

		open();

		expect(screen.getByRole('checkbox', { name: /coverage/ })).toHaveTextContent(/^coverage$/);
	});

	test('says how many are selected without listing them, so the bar stays one row wide', () => {
		setupDropdown({ selected: ['implement', 'refactor'] });

		expect(screen.getByRole('button', { name: /command/ })).toHaveTextContent('2');
	});
});
