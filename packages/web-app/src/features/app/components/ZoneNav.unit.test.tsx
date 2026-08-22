import { describe, expect, jest, test } from '@jest/globals';
import { screen } from '@testing-library/react';
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
// The walk behind the server function the query reads. Only the test that
// leaves the cache empty on purpose reaches it.
jest.mock('#src/common/utils/findRepoRoot.ts', () => ({
	findRepoRoot: () => undefined,
}));
// -------------------------

// Three answers, three inputs: a path, an explicit `undefined` for the lookup
// that found no repo, and `null` to seed nothing at all — the lookup that has
// not answered, or failed. `repoRoot` is read rather than destructured with a
// default, because a default parameter would swallow that explicit `undefined`.
const setupZoneNav = (params: { repoRoot?: string | null } = {}) => {
	const repoRoot = Object.hasOwn(params, 'repoRoot') ? params.repoRoot : '/repos/lightsout';

	renderWithQueryClient({
		ui: <ZoneNav />,
		seed: repoRoot === null ? [] : [{ queryKey: [QueryKey.RepoRoot], data: { repoRoot } }],
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

		expect(runs).toHaveAttribute('href', '/repo/runs');
	});

	test('offers what this repo enforces', () => {
		setupZoneNav();

		const standards = screen.getByRole('link', { name: 'Standards' });

		expect(standards).toHaveAttribute('href', '/repo/standards');
	});

	test('renders nothing at all when no repo was found', () => {
		setupZoneNav({ repoRoot: undefined });

		const zone = screen.queryByRole('navigation', { name: 'Your repo' });

		expect(zone).not.toBeInTheDocument();
	});

	test('renders nothing while the lookup has not answered, rather than taking the shell down with it', () => {
		setupZoneNav({ repoRoot: null });

		const zone = screen.queryByRole('navigation', { name: 'Your repo' });

		expect(zone).not.toBeInTheDocument();
	});
});
