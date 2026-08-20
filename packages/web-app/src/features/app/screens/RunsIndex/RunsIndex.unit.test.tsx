import { describe, expect, jest, test } from '@jest/globals';
import type { RunListing } from '@lightsout/engine';
import { screen } from '@testing-library/react';
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

const setupRunsIndex = ({ runs = [buildRunListing()], repoRoot = '/repos/lightsout' }: { runs?: RunListing[]; repoRoot?: string } = {}) => {
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

		const summary = screen.getByText(/found in/);

		expect(summary.textContent).toContain('2 runs found in /repos/other-project');
	});

	test('says one run rather than one runs', () => {
		setupRunsIndex({ runs: [buildRunListing()] });

		const summary = screen.getByText(/found in/);

		expect(summary.textContent).toContain('1 run found in');
	});

	test('points the reader at the sidebar, since nothing is open yet', () => {
		setupRunsIndex();

		const prompt = screen.getByRole('heading', { name: 'Pick a run on the left.' });

		expect(prompt).toBeInTheDocument();
	});
});
