import { describe, expect, jest, test } from '@jest/globals';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { Home } from '#src/features/home/screens/Home/Home.tsx';
import { buildStandardsPackView } from '#tests/helpers/buildStandardsPackView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// Home reads one query it never warms — the default pack's three numbers.
// Seeded, it resolves; unseeded, the server function behind it is stubbed with
// a promise that never settles, the moment before the pack arrives.
jest.mock('#src/features/packs/internal/serverFns/getDefaultPackServerFn.ts', () => ({ getDefaultPackServerFn: () => new Promise(() => {}) }));
// -------------------------
// The links, which need a live router around them to resolve a path.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------

/**
 * The whole page with an empty cache — which is what a build holding no repo
 * actually renders, since Home warms nothing and suspends on nothing.
 */
const setupHome = ({ isPackLoaded = false }: { isPackLoaded?: boolean } = {}) => {
	renderWithQueryClient({
		ui: <Home />,
		seed: isPackLoaded ? [{ queryKey: [QueryKey.DefaultPack], data: buildStandardsPackView() }] : [],
	});
};

describe('Home', () => {
	test('renders with nothing in the cache, because a public build has nothing to warm it with', () => {
		setupHome();

		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Stop the slop.');
	});

	test('composes all seven sections, in the order a reader meets them', () => {
		setupHome();

		const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);

		expect(headings).toStrictEqual([
			'Lightsout cleans as it codes.',
			'Your standards, enforced at every step.',
			'Humans decide. Agents execute.',
			'Deterministic gates decide what passes. Not the agent.',
			'Every decision, recorded on your ticket.',
			'Hand it off. Walk away.',
		]);
	});

	test('opens and closes on the install line', () => {
		setupHome();

		expect(screen.getAllByRole('button', { name: 'Copy install command' })).toHaveLength(2);
	});

	test('paints the default pack’s numbers once they arrive', () => {
		setupHome({ isPackLoaded: true });

		expect(screen.getByText('rules in the default TypeScript pack')).toBeInTheDocument();
	});
});
