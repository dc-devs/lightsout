import { describe, expect, jest, test } from '@jest/globals';
import type { RunListing, StandardsView } from '@lightsout/engine';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { AppShell } from '#src/features/app/index.ts';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';
import { buildStandardsView } from '#tests/helpers/buildStandardsView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children }: { to: string; params?: Record<string, string>; children: ReactNode }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)}>{children}</a>
	),
	Outlet: () => <p>the open route</p>,
}));
// -------------------------
// The reader behind the standards server function, reached only by the test
// that leaves the standards cache empty on purpose: under Jest the Start stub
// hands `handler()` straight back, so an unseeded key would otherwise send a
// real read at the engine's package loader.
const mockGetStandards = jest.fn<() => Promise<StandardsView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ getStandards: () => mockGetStandards() }),
}));
// -------------------------

// The standards view is seeded like every other key the shell reads: the
// sidebar subscribes to it for its badge. Passing `null` instead seeds nothing,
// which is the repo that has never run a check or whose packages will not load.
const setupAppShell = ({
	runs = [buildRunListing()],
	repoRoot = '/repos/lightsout',
	standards = buildStandardsView(),
}: {
	runs?: RunListing[];
	repoRoot?: string;
	standards?: StandardsView | null;
} = {}) => {
	jest.useFakeTimers();
	jest.setSystemTime(new Date('2026-01-01T00:03:00.000Z'));
	mockGetStandards.mockRejectedValue(new Error('no standards package could be loaded'));
	renderWithQueryClient({
		ui: <AppShell />,
		seed: [
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot } },
			{ queryKey: [QueryKey.Runs], data: runs },
			...(standards === null ? [] : [{ queryKey: [QueryKey.Standards], data: standards }]),
		],
	});
};

describe('AppShell', () => {
	test('names the repo whose run state the app is reading', () => {
		setupAppShell({ repoRoot: '/repos/other-project' });

		const root = screen.getByText('/repos/other-project');

		expect(root).toBeInTheDocument();
	});

	test('offers a way into the standards tab', () => {
		setupAppShell();

		const standards = screen.getByRole('link', { name: 'Standards' });

		expect(standards).toHaveAttribute('href', '/standards');
	});

	test('carries the count of blocking findings into that link, so debt is visible from every page', () => {
		setupAppShell({ standards: buildStandardsView({ overrides: { totals: { rules: 1, checked: 1, judgment: 0, blocking: 4, advisory: 2, orphans: 0 } } }) });

		const standards = screen.getByRole('link', { name: 'Standards 4' });

		expect(standards).toBeInTheDocument();
	});

	test('shows no badge on a repo with nothing blocking, rather than a zero', () => {
		setupAppShell();

		const standards = screen.getByRole('link', { name: 'Standards' });

		expect(standards.querySelector('[data-slot="badge"]')).not.toBeInTheDocument();
	});

	test('leaves the link uncounted and the runs list readable when the standards view cannot be read at all', async () => {
		setupAppShell({ standards: null, runs: [buildRunListing({ runId: 'ffff0000ffff', title: 'raise coverage' })] });

		const standards = await screen.findByRole('link', { name: 'Standards' });
		const runs = screen.getByRole('navigation', { name: 'Runs' });

		expect(standards).toBeInTheDocument();
		expect(runs.textContent).toContain('raise coverage');
	});

	test('fills the sidebar with the runs list', () => {
		setupAppShell({ runs: [buildRunListing(), buildRunListing({ runId: 'ffff0000ffff', title: 'raise coverage' })] });

		const runs = screen.getByRole('navigation', { name: 'Runs' });

		expect(runs.textContent).toContain('raise coverage');
	});

	test('renders the open route beside the sidebar', () => {
		setupAppShell();

		const outlet = screen.getByText('the open route');

		expect(outlet).toBeInTheDocument();
	});
});
