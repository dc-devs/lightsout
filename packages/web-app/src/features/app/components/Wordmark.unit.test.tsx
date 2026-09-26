import { describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Wordmark } from '#src/features/app/components/Wordmark.tsx';

// Mocked Imports
// -------------------------
// Only the link, which needs a live router around it to resolve a path.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, children, className, 'aria-label': ariaLabel }: { to: string; children: ReactNode; className?: string; 'aria-label'?: string }) => (
		<a href={to} className={className} aria-label={ariaLabel}>
			{children}
		</a>
	),
}));
// -------------------------

describe('Wordmark', () => {
	test('names the product and takes a reader back to the front page', () => {
		render(<Wordmark />);

		expect(screen.getByRole('link', { name: 'lightsout' })).toHaveAttribute('href', '/');
	});

	test('keeps the bulb out of the link name, since the word already says it', () => {
		const { container } = render(<Wordmark />);

		expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
	});

	test('says what stage the product is at, beside the name', () => {
		render(<Wordmark />);

		expect(screen.getByText('Alpha')).toBeInTheDocument();
	});

	test('takes a class from the bar it sits in', () => {
		render(<Wordmark className="shrink-0" />);

		expect(screen.getByRole('link', { name: 'lightsout' })).toHaveClass('shrink-0');
	});
});
