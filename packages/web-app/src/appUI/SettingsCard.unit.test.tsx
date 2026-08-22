import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { SettingsCard } from '#src/appUI/SettingsCard.tsx';

const setupSettingsCard = ({ description, action, className }: { description?: string; action?: string; className?: string } = {}) => {
	render(
		<SettingsCard
			title="Coverage"
			description={description}
			action={action === undefined ? undefined : <button type="button">{action}</button>}
			className={className}
		>
			<p>95% of statements</p>
		</SettingsCard>,
	);
};

describe('SettingsCard', () => {
	test('names the setting and shows its value', () => {
		setupSettingsCard();

		const heading = screen.getByRole('heading', { level: 3, name: 'Coverage' });
		const body = screen.getByText('95% of statements');

		expect(heading).toBeInTheDocument();
		expect(body).toBeInTheDocument();
	});

	test('explains the setting under its name when given a description', () => {
		setupSettingsCard({ description: 'What the gate holds this repo to.' });

		const description = screen.getByText('What the gate holds this repo to.');

		expect(description).toBeInTheDocument();
	});

	test('leaves the description out rather than rendering an empty line', () => {
		setupSettingsCard();

		const header = screen.getByRole('heading', { level: 3, name: 'Coverage' }).closest('header');

		expect(header?.querySelector('p')).toBeNull();
	});

	test('puts the control the card is about on its title row, not in the body', () => {
		setupSettingsCard({ action: 'Edit' });

		const header = screen.getByRole('button', { name: 'Edit' }).closest('header');

		expect(header?.querySelector('h3')?.textContent).toBe('Coverage');
	});

	test('lets a caller class through', () => {
		setupSettingsCard({ className: 'col-span-2' });

		const card = screen.getByRole('heading', { level: 3, name: 'Coverage' }).closest('section');

		expect(card?.className).toContain('col-span-2');
	});
});
