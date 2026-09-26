import { describe, expect, jest, test } from '@jest/globals';
import { screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { ZoneNav } from '#src/features/app/components/ZoneNav.tsx';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

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

const setupZoneNav = ({ repoRoot = '/repos/lightsout' }: { repoRoot?: string } = {}) => {
	renderWithQueryClient({
		ui: <ZoneNav />,
		seed: [{ queryKey: [QueryKey.RepoRoot], data: { repoRoot } }],
	});
};

describe('ZoneNav', () => {
	test('names the repo whose run state the app is reading', () => {
		setupZoneNav({ repoRoot: '/repos/other-project' });

		const root = screen.getByText('/repos/other-project');

		expect(root).toBeInTheDocument();
	});

	test('offers the runs list', () => {
		setupZoneNav();

		const runs = screen.getByRole('link', { name: 'Runs' });

		expect(runs).toHaveAttribute('href', '/app/runs');
	});

	test('offers what was settled before any agent ran', () => {
		setupZoneNav();

		const plans = screen.getByRole('link', { name: 'Plans' });

		expect(plans).toHaveAttribute('href', '/app/plans');
	});

	test('offers what this repo enforces', () => {
		setupZoneNav();

		const standards = screen.getByRole('link', { name: 'Standards' });

		expect(standards).toHaveAttribute('href', '/app/standards');
	});

	test('opens on the page that answers whether anything needs a person right now', () => {
		setupZoneNav();

		const health = screen.getByRole('link', { name: 'Health' });

		expect(health).toHaveAttribute('href', '/app');
	});

	test('offers what agents said got in their way', () => {
		setupZoneNav();

		const friction = screen.getByRole('link', { name: 'Friction' });

		expect(friction).toHaveAttribute('href', '/app/friction');
	});

	test('offers what this repo told lightsout', () => {
		setupZoneNav();

		const config = screen.getByRole('link', { name: 'Config' });

		expect(config).toHaveAttribute('href', '/app/config');
	});

	test('orders the zone from the page that says what needs a person to the pages that say what was settled', () => {
		setupZoneNav();

		const zone = screen.getByRole('navigation', { name: 'Your repo' });
		const entries = within(zone)
			.getAllByRole('link')
			.map((link) => link.textContent);

		expect(entries).toEqual(['Health', 'Runs', 'Plans', 'Standards', 'Friction', 'Config']);
	});
});
