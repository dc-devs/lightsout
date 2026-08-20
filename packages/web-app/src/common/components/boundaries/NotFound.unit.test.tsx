import { describe, expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { NotFound } from '#src/common/components/boundaries/NotFound.tsx';

// Mocked Imports
// -------------------------
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
// -------------------------

const setupNotFound = ({ children }: { children?: ReactNode } = {}) => {
	render(<NotFound>{children}</NotFound>);
};

describe('NotFound', () => {
	test('says the page does not exist when the caller says nothing more', () => {
		setupNotFound();

		const message = screen.getByText('That page does not exist.');

		expect(message).toBeInTheDocument();
	});

	test('shows what the caller supplied instead of the default sentence', () => {
		setupNotFound({ children: 'No run answers to that id.' });

		const message = screen.getByText('No run answers to that id.');

		expect(message).toBeInTheDocument();
	});

	test('offers a way back to the runs list', () => {
		setupNotFound();

		const home = screen.getByRole('link', { name: 'Back to runs' });

		expect(home).toHaveAttribute('href', '/');
	});
});
