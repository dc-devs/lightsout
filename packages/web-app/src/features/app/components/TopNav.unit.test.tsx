import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TopNav } from '#src/features/app/index.ts';
import { ThemeProvider } from '#src/theme/index.ts';

// Mocked Imports
// -------------------------
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
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

	test('offers the standards packs page, now that it is built', () => {
		setupTopNav();

		const packs = screen.getAllByRole('link', { name: 'Standards packs' });

		expect(packs[0]).toHaveAttribute('href', '/standards');
	});

	test.each([
		{ label: 'Commands', href: '/commands' },
		{ label: 'Docs', href: '/docs/configuration' },
	])('offers $label, now that it is built', ({ label, href }) => {
		setupTopNav();

		const page = screen.getAllByRole('link', { name: label });

		expect(page[0]).toHaveAttribute('href', href);
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

	test('offers the standards packs page from the menu as well as from the row', () => {
		setupTopNav();

		fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
		const packs = within(screen.getByRole('navigation', { name: 'Site pages' })).getByRole('link', { name: 'Standards packs' });

		expect(packs).toHaveAttribute('href', '/standards');
	});

	test.each([
		{ label: 'Commands', href: '/commands' },
		{ label: 'Docs', href: '/docs/configuration' },
	])('offers $label from the menu at the same address the row uses', ({ label, href }) => {
		setupTopNav();

		fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
		const page = within(screen.getByRole('navigation', { name: 'Site pages' })).getByRole('link', { name: label });

		expect(page).toHaveAttribute('href', href);
	});

	test('keeps the menu closed until the menu button is pressed', () => {
		setupTopNav();

		const menu = screen.queryByRole('navigation', { name: 'Site pages' });

		expect(menu).toBeNull();
	});
});
