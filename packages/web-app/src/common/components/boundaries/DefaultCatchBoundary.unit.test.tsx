import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { DefaultCatchBoundary } from '#src/common/components/boundaries/DefaultCatchBoundary.tsx';

// Mocked Imports
// -------------------------
const mockInvalidate = jest.fn<() => Promise<void>>();

jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
	useRouter: () => ({ invalidate: mockInvalidate }),
}));
// -------------------------

const setupDefaultCatchBoundary = ({ message = 'the gate exploded' }: { message?: string } = {}) => {
	mockInvalidate.mockResolvedValue(undefined);
	render(<DefaultCatchBoundary error={new Error(message)} reset={() => {}} info={{ componentStack: '' }} />);
};

describe('DefaultCatchBoundary', () => {
	test('shows the message the route threw', () => {
		setupDefaultCatchBoundary({ message: 'manifest would not read' });

		const message = screen.getByText('manifest would not read');

		expect(message).toBeInTheDocument();
	});

	test('re-runs the route when the reader tries again', () => {
		setupDefaultCatchBoundary();

		fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

		expect(mockInvalidate).toHaveBeenCalledTimes(1);
	});

	test('offers a way back to the runs list', () => {
		setupDefaultCatchBoundary();

		const home = screen.getByRole('link', { name: 'Back to runs' });

		expect(home).toHaveAttribute('href', '/');
	});
});
