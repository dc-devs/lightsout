import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TopNav } from '#src/features/app/components/TopNav.tsx';
import { ThemeProvider } from '#src/theme/index.ts';

// Mocked Imports
// -------------------------
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
		<a href={to} className={className}>
			{children}
		</a>
	),
}));
// -------------------------

const setupTopNav = () => {
	render(
		<ThemeProvider>
			<TopNav />
		</ThemeProvider>,
	);
};

describe('TopNav', () => {
	test('takes the wordmark back to the front page', () => {
		setupTopNav();

		const wordmark = screen.getByRole('link', { name: 'lightsout' });

		expect(wordmark).toHaveAttribute('href', '/');
	});

	test('names a page that is not built yet without offering to navigate there', () => {
		setupTopNav();

		const packs = screen.getByTitle('The standards packs page arrives with the pack pages.');

		expect(packs).toHaveAttribute('aria-disabled', 'true');
	});

	test('offers the project source', () => {
		setupTopNav();

		const source = screen.getByRole('link', { name: 'GitHub' });

		expect(source).toHaveAttribute('href', 'https://github.com/dc-devs/lightsout');
	});

	test('carries the theme control, since it belongs to the reader rather than to a page', () => {
		setupTopNav();

		const toggle = screen.getByRole('button', { name: 'Switch to system theme' });

		expect(toggle).toBeInTheDocument();
	});

	test('opens the same pages behind a menu button, for a screen too narrow for the row', () => {
		setupTopNav();

		fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
		const menu = screen.getByRole('navigation', { name: 'Site pages' });

		expect(menu.textContent).toContain('Commands');
	});
});
