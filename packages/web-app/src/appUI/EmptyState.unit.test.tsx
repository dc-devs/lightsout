import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { EmptyState } from '#src/appUI/EmptyState.tsx';

describe('EmptyState', () => {
	test('says what is missing', () => {
		render(<EmptyState title="No runs yet." />);

		expect(screen.getByText('No runs yet.')).toBeInTheDocument();
	});

	test('carries the sentence and the control that would fill it', () => {
		render(<EmptyState icon={Inbox} title="No runs match these filters." description="Widen them." action={<button type="button">Clear filters</button>} />);

		expect(screen.getByText('Widen them.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
	});

	test('leaves the description and the action out entirely when it was given neither', () => {
		const { container } = render(<EmptyState title="Nothing here." />);

		expect(screen.queryByRole('button')).not.toBeInTheDocument();
		expect(container.firstChild?.childNodes).toHaveLength(1);
	});

	test('draws the icon it was given without announcing it to a screen reader', () => {
		const { container } = render(<EmptyState icon={Inbox} title="No runs yet." />);

		expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
	});

	test('leaves the icon out rather than reserving a blank slot', () => {
		const { container } = render(<EmptyState title="No runs yet." />);

		expect(container.querySelector('svg')).not.toBeInTheDocument();
	});
});
