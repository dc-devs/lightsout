import { describe, expect, jest, test } from '@jest/globals';
import type { StandardsPackView } from '@lightsout/engine';
import { screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { PacksPage } from '#src/features/packs/index.ts';
import { buildStandardsPackView } from '#tests/helpers/buildStandardsPackView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// Every card is a link, and a link needs a live router to resolve a path. A
// plain anchor keeps the assertions about where a card points rather than about
// the routing library — with its search and hash spelled out, since a card opens
// its pack filtered to one set of rules and one link points at a doc section.
jest.mock('@tanstack/react-router', () => ({
	Link: ({
		to,
		params,
		search,
		hash,
		children,
		className,
	}: {
		to: string;
		params?: Record<string, string>;
		search?: Record<string, string>;
		hash?: string;
		children: ReactNode;
		className?: string;
	}) => {
		const path = Object.entries(params ?? {}).reduce((built, [name, value]) => built.replace(`$${name}`, value), to);
		const query = search === undefined ? '' : `?${new URLSearchParams(search).toString()}`;

		return (
			<a href={`${path}${query}${hash === undefined ? '' : `#${hash}`}`} className={className}>
				{children}
			</a>
		);
	},
}));
// -------------------------

const setupPacksPage = ({ pack = buildStandardsPackView() }: { pack?: StandardsPackView } = {}) => {
	renderWithQueryClient({ ui: <PacksPage />, seed: [{ queryKey: [QueryKey.DefaultPack], data: pack }] });
};

/** The headings of the rule-set cards, in the order the page draws them. */
const readCardNames = () => screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);

describe('PacksPage', () => {
	test('introduces what a Standards Pack is, in one line', () => {
		setupPacksPage();

		expect(screen.getByRole('heading', { level: 1, name: 'Standards Packs' })).toBeInTheDocument();
	});

	test('shows one card per set of rules, by the name a reader knows it by, then a card for a team’s own', () => {
		setupPacksPage();

		expect(readCardNames().slice(0, 3)).toStrictEqual(['TypeScript', 'React', 'Your team’s pack']);
	});

	test('leaves out a framework the pack holds no rules for', () => {
		setupPacksPage({
			pack: { ...buildStandardsPackView(), channels: ['base', 'nestjs'], channelTotals: [{ channel: 'base', rules: 97, checked: 45, judgment: 52 }] },
		});

		expect(readCardNames()).not.toContain('Nestjs');
	});

	test('opens a card’s rules at the set’s own address', () => {
		setupPacksPage();

		const card = screen.getByRole('link', { name: /React/ });

		expect(card).toHaveAttribute('href', '/standards-packs/react');
	});

	test('says how many rules a set holds, and how many are deterministic checks and agent checks', () => {
		setupPacksPage();

		const card = screen.getByRole('link', { name: /TypeScript/ });

		expect([within(card).getByText('47 deterministic checks'), within(card).getByText('54 agent checks')]).toHaveLength(2);
	});

	test('says when each set applies', () => {
		setupPacksPage();

		const activations = ['TypeScript', 'React'].map(
			(name) => within(screen.getByRole('link', { name: new RegExp(name) })).getByText(/^(Always on|On with)/).textContent,
		);

		expect(activations).toStrictEqual(['Always on', 'On with React']);
	});

	test('points a team at the docs for writing its own pack', () => {
		setupPacksPage();

		expect(screen.getByRole('link', { name: 'How to add your own' })).toHaveAttribute('href', '/docs/configuration#adding-your-standards');
	});
});
