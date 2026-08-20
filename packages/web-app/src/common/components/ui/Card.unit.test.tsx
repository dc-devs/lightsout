import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { Card } from '#src/common/components/ui/Card.tsx';

const setupCard = ({ title, action, className }: { title?: string; action?: string; className?: string } = {}) => {
	render(
		<Card title={title} action={action === undefined ? undefined : <button type="button">{action}</button>} className={className}>
			<p>the evidence</p>
		</Card>,
	);
};

describe('Card', () => {
	test('renders whatever it was given to hold', () => {
		setupCard();

		const body = screen.getByText('the evidence');

		expect(body).toBeInTheDocument();
	});

	test('heads the panel when a title is given', () => {
		setupCard({ title: 'Gate evidence' });

		const heading = screen.getByRole('heading', { name: 'Gate evidence' });

		expect(heading).toBeInTheDocument();
	});

	test('carries no heading row at all when no title is given', () => {
		setupCard();

		const heading = screen.queryByRole('heading');

		expect(heading).not.toBeInTheDocument();
	});

	test('puts the action beside the title', () => {
		setupCard({ title: 'Gate evidence', action: 'show passing gates' });

		const action = screen.getByRole('button', { name: 'show passing gates' });

		expect(action).toBeInTheDocument();
	});

	test('lets a caller class replace the shape the card picked for itself', () => {
		setupCard({ className: 'rounded-none' });

		const classes = screen.getByText('the evidence').parentElement?.parentElement?.className.split(' ') ?? [];

		expect(classes).toEqual(expect.arrayContaining(['rounded-none']));
		expect(classes).not.toContain('rounded-lg');
	});
});
