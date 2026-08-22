import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { AppShell } from '#src/features/app/index.ts';
import { ThemeProvider } from '#src/theme/index.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
		<a href={to} className={className}>
			{children}
		</a>
	),
	Outlet: () => <p>the open route</p>,
}));
// -------------------------

// `repoRoot` is read rather than destructured with a default, because an
// explicit `undefined` is the no-repo case a default parameter would swallow.
const setupAppShell = (params: { repoRoot?: string } = {}) => {
	const repoRoot = Object.hasOwn(params, 'repoRoot') ? params.repoRoot : '/repos/lightsout';

	renderWithQueryClient({
		ui: (
			<ThemeProvider>
				<AppShell />
			</ThemeProvider>
		),
		seed: [{ queryKey: [QueryKey.RepoRoot], data: { repoRoot } }],
	});
};

describe('AppShell', () => {
	test('carries the site bar on every page', () => {
		setupAppShell();

		const site = screen.getByRole('navigation', { name: 'Site' });

		expect(site).toBeInTheDocument();
	});

	test('offers the local zone when a repo was found, and names it', () => {
		setupAppShell({ repoRoot: '/repos/other-project' });

		const zone = screen.getByRole('navigation', { name: 'Your repo' });

		expect(zone).toBeInTheDocument();
	});

	test('leaves the local zone out entirely when no repo was found, which is what a public build renders', () => {
		setupAppShell({ repoRoot: undefined });

		const zone = screen.queryByRole('navigation', { name: 'Your repo' });

		expect(zone).not.toBeInTheDocument();
	});

	test('renders the open route beside that navigation', () => {
		setupAppShell();

		const outlet = screen.getByText('the open route');

		expect(outlet).toBeInTheDocument();
	});

	test('sends the wordmark back to the landing page', () => {
		setupAppShell();

		const wordmark = screen.getByRole('link', { name: 'lightsout' });

		expect(wordmark).toHaveAttribute('href', '/');
	});

	test('names a page that has no route yet without linking to it, so no reader is navigated into the not-found panel', () => {
		setupAppShell();

		const upcoming = screen.getByText('Commands');

		expect(upcoming).toHaveAttribute('aria-disabled', 'true');
		expect(screen.queryByRole('link', { name: 'Commands' })).not.toBeInTheDocument();
	});

	test('opens the site pages in a sheet when the menu button is pressed, which is how a narrow screen reaches them', () => {
		setupAppShell();

		const menuButton = screen.getByRole('button', { name: 'Open menu' });
		fireEvent.click(menuButton);

		const sheet = screen.getByRole('navigation', { name: 'Site pages' });

		expect(sheet).toHaveTextContent('Commands');
	});

	test('leaves the sheet closed until the menu button is pressed', () => {
		setupAppShell();

		const sheet = screen.queryByRole('navigation', { name: 'Site pages' });

		expect(sheet).not.toBeInTheDocument();
	});

	test('says which repo the local zone reads, and keeps the full path as a tooltip because the column truncates it', () => {
		setupAppShell({ repoRoot: '/repos/other-project' });

		const path = screen.getByText('/repos/other-project');

		expect(path).toHaveAttribute('title', '/repos/other-project');
	});

	test('points the local zone at the repo pages, which now live under /repo', () => {
		setupAppShell();

		const runs = screen.getByRole('link', { name: 'Runs' });
		const standards = screen.getByRole('link', { name: 'Standards' });

		expect([runs.getAttribute('href'), standards.getAttribute('href')]).toEqual(['/repo/runs', '/repo/standards']);
	});

	test('offers the source repository as an outward link that leaves the app', () => {
		setupAppShell();

		const github = screen.getByRole('link', { name: 'GitHub' });

		expect(github).toHaveAttribute('href', 'https://github.com/dc-devs/lightsout');
		expect(github).toHaveAttribute('target', '_blank');
	});
});
