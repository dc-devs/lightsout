import { describe, expect, jest, test } from '@jest/globals';
import type { RunListing } from '@lightsout/engine';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { AppShell } from '#src/features/app/index.ts';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';
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

const setupAppShell = ({ runs = [buildRunListing()], repoRoot = '/repos/lightsout' }: { runs?: RunListing[]; repoRoot?: string } = {}) => {
	jest.useFakeTimers();
	jest.setSystemTime(new Date('2026-01-01T00:03:00.000Z'));
	renderWithQueryClient({
		ui: <AppShell />,
		seed: [
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot } },
			{ queryKey: [QueryKey.Runs], data: runs },
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
