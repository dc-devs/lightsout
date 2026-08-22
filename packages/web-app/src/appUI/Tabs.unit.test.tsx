import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { Tabs } from '#src/appUI/Tabs.tsx';

const items = [
	{ value: 'steps', label: 'Steps', content: <p>eight steps</p> },
	{ value: 'gates', label: 'Gates', content: <p>four gates</p> },
];

const setupTabs = ({ defaultValue, value, onValueChange }: { defaultValue?: string; value?: string; onValueChange?: (next: string) => void } = {}) => {
	render(<Tabs items={items} defaultValue={defaultValue} value={value} onValueChange={onValueChange} className="mt-4" />);
};

const setupEmptyTabs = () => {
	render(<Tabs items={[]} />);
};

// A tab strip selects on the press, not on the release. A bare `click` fires
// no mouse-down, so the strip would stay exactly where it was.
const chooseTab = ({ name }: { name: string }) => {
	fireEvent.mouseDown(screen.getByRole('tab', { name }));
};

describe('Tabs', () => {
	test('opens on the first tab when told nothing else', () => {
		setupTabs();

		const open = screen.getByText('eight steps');

		expect(open).toBeInTheDocument();
	});

	test('opens on the tab a caller named', () => {
		setupTabs({ defaultValue: 'gates' });

		const open = screen.getByText('four gates');

		expect(open).toBeInTheDocument();
	});

	test('switches panels when a tab is chosen', () => {
		setupTabs();

		chooseTab({ name: 'Gates' });
		const open = screen.getByText('four gates');

		expect(open).toBeInTheDocument();
	});

	test('reports the chosen tab to a caller holding the value itself', () => {
		const onValueChange = jest.fn<(value: string) => void>();
		setupTabs({ value: 'steps', onValueChange });

		chooseTab({ name: 'Gates' });

		expect(onValueChange).toHaveBeenCalledWith('gates');
	});

	test('shows every tab it was given', () => {
		setupTabs();

		const tabs = screen.getAllByRole('tab');

		expect(tabs.map((tab) => tab.textContent)).toStrictEqual(['Steps', 'Gates']);
	});

	test('stays an empty strip when it was given no tabs, rather than reaching for a first tab that is not there', () => {
		setupEmptyTabs();

		const tabs = screen.queryAllByRole('tab');
		const panels = screen.queryAllByRole('tabpanel');

		expect(tabs).toHaveLength(0);
		expect(panels).toHaveLength(0);
	});
});
