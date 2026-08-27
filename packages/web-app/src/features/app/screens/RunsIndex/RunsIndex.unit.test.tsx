import { describe, expect, jest, test } from '@jest/globals';
import type { RunListing } from '@lightsout/engine';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { RunsIndex } from '#src/features/app/screens/RunsIndex/RunsIndex.tsx';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The screen reads its two query options objects, and the runs one reaches the
// engine's filesystem reader at the far end of the server function behind it.
// Stubbing the reader keeps that module graph off disk; the seeded cache is
// what keeps the fetcher from ever being called.
jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ listRuns: () => Promise.resolve([]) }),
}));
// -------------------------
// Only the link, which needs a live router around it to resolve a path.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
		<a href={to} className={className}>
			{children}
		</a>
	),
}));
// -------------------------

// `repoRoot` is read rather than destructured with a default, because an
// explicit `undefined` is the no-repo case a default parameter would swallow.
const setupRunsIndex = (params: { runs?: RunListing[]; repoRoot?: string } = {}) => {
	const { runs = [buildRunListing()] } = params;
	const repoRoot = Object.hasOwn(params, 'repoRoot') ? params.repoRoot : '/repos/lightsout';

	renderWithQueryClient({
		ui: <RunsIndex />,
		seed: [
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot } },
			{ queryKey: [QueryKey.Runs], data: runs },
		],
	});
};

describe('RunsIndex', () => {
	test('counts the runs found and names the repo they came from', () => {
		setupRunsIndex({ runs: [buildRunListing(), buildRunListing({ runId: 'ffff0000ffff' })], repoRoot: '/repos/other-project' });

		const summary = screen.getByText(/runs in/);

		expect(summary.textContent).toContain('2 runs in /repos/other-project');
	});

	test('says one run rather than one runs', () => {
		setupRunsIndex({ runs: [buildRunListing()] });

		const summary = screen.getByText(/run in/);

		expect(summary.textContent).toContain('1 run in');
	});

	test('names the zone it is the landing page of, whether or not a repo was found', () => {
		setupRunsIndex();

		const prompt = screen.getByRole('heading', { name: 'Your repo' });

		expect(prompt).toBeInTheDocument();
	});

	test('offers the way into that list', () => {
		setupRunsIndex();

		const open = screen.getByRole('link', { name: 'See the runs →' });

		expect(open).toHaveAttribute('href', '/repo/runs');
	});

	test('says no repo was found rather than counting runs that came from nowhere', () => {
		setupRunsIndex({ repoRoot: undefined, runs: [] });

		const advice = screen.getByText(/No lightsout repo found above this directory/);

		expect(advice).toBeInTheDocument();
	});

	test('names the two ways of pointing the app at a repo', () => {
		setupRunsIndex({ repoRoot: undefined, runs: [] });

		const advice = screen.getByText(/run from inside one/);

		expect(advice.textContent).toContain('LIGHTSOUT_REPO');
	});

	test('keeps the heading and drops the count when no repo was found, since there is nothing to count', () => {
		setupRunsIndex({ repoRoot: undefined, runs: [] });

		expect(screen.getByRole('heading', { name: 'Your repo' })).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'See the runs →' })).not.toBeInTheDocument();
	});
});
