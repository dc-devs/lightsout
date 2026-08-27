import { describe, expect, jest, test } from '@jest/globals';
import type { StandardsPackListing } from '@lightsout/engine';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { PacksPage } from '#src/features/packs/index.ts';
import { buildStandardsPackListing } from '#tests/helpers/buildStandardsPackListing.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// Each card's name is a link to the pack's own page, and a link needs a live
// router to resolve a path. A plain anchor keeps the assertions about where the
// card points rather than about the routing library. `hash` is spelled out
// because one link on this page points at a section of a doc rather than at its
// top, and the two would otherwise be indistinguishable.
jest.mock('@tanstack/react-router', () => ({
	Link: ({
		to,
		params,
		hash,
		children,
		className,
	}: {
		to: string;
		params?: Record<string, string>;
		hash?: string;
		children: ReactNode;
		className?: string;
	}) => (
		<a
			href={`${Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)}${hash === undefined ? '' : `#${hash}`}`}
			className={className}
		>
			{children}
		</a>
	),
}));
// -------------------------

const setupPacksPage = ({ packs = [buildStandardsPackListing()] }: { packs?: StandardsPackListing[] } = {}) => {
	renderWithQueryClient({ ui: <PacksPage />, seed: [{ queryKey: [QueryKey.Packs], data: packs }] });
};

/** The config block the page offers, parsed, so the assertion pins the entries rather than the indentation. */
const readConfigSnippet = (): unknown => JSON.parse(screen.getByText(/"standards-packs"/).textContent ?? '');

describe('PacksPage', () => {
	test('says plainly that it found nothing, rather than erroring, when no pack resolved', () => {
		setupPacksPage({ packs: [] });

		const notice = screen.getByText('No standards pack could be found from here.');

		expect(notice).toBeInTheDocument();
	});

	test('leaves the intro and the config card off that empty page, since neither has anything true to say', () => {
		setupPacksPage({ packs: [] });

		expect(screen.getByRole('heading', { level: 1, name: 'Standards packs' })).toBeInTheDocument();
		expect(screen.queryByRole('heading', { name: 'Use these packs' })).not.toBeInTheDocument();
		expect(screen.queryByText(/A standards pack is a folder of rules/)).not.toBeInTheDocument();
	});

	test('lists every configured pack by its own repo-relative path, which is what a repo would paste', () => {
		setupPacksPage({
			packs: [
				buildStandardsPackListing(),
				buildStandardsPackListing({ name: 'acme-house-rules', isDefault: false, path: 'packages/house-standards' }),
				buildStandardsPackListing({ name: 'acme-react', isDefault: false, path: '../shared/react-pack' }),
			],
		});

		const config = readConfigSnippet();

		expect(config).toStrictEqual({ 'standards-packs': ['packages/house-standards', '../shared/react-pack'] });
	});

	test('shows an illustrative entry instead when only the default pack loaded, because a real list would be empty', () => {
		setupPacksPage();

		const config = readConfigSnippet();

		expect(config).toStrictEqual({ 'standards-packs': ['./packages/house-standards'] });
	});

	test('says the default pack needs no entry, so a reader does not paste the illustration as fact', () => {
		setupPacksPage();

		const note = screen.getByText(/add entries only for your own packs/);

		expect(note).toBeInTheDocument();
	});

	test('drops that note once a real pack is configured, where the snippet is the repo it is looking at', () => {
		setupPacksPage({ packs: [buildStandardsPackListing(), buildStandardsPackListing({ name: 'acme-house-rules', isDefault: false })] });

		const note = screen.queryByText(/add entries only for your own packs/);

		expect(note).not.toBeInTheDocument();
	});

	test('offers the snippet for copying, since it is meant to be pasted rather than retyped', () => {
		setupPacksPage();

		const copy = screen.getByRole('button', { name: /copy config/i });

		expect(copy).toBeInTheDocument();
	});

	test('renders one card per pack, in the order the engine listed them', () => {
		setupPacksPage({
			packs: [buildStandardsPackListing(), buildStandardsPackListing({ name: 'acme-house-rules', isDefault: false })],
		});

		const names = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);

		expect(names).toStrictEqual(['lightsout-defaults', 'acme-house-rules']);
	});
});

describe('PacksPage pack cards', () => {
	test('marks the pack a run loads when the config names none', () => {
		setupPacksPage({ packs: [buildStandardsPackListing({ isDefault: true })] });

		const badge = screen.getByText('default — loads when you say nothing');

		expect(badge).toBeInTheDocument();
	});

	test('leaves that mark off a pack the config asked for by name', () => {
		setupPacksPage({ packs: [buildStandardsPackListing({ isDefault: false })] });

		const badge = screen.queryByText('default — loads when you say nothing');

		expect(badge).not.toBeInTheDocument();
	});

	test('says when a pack shipped without its fixtures, which is why its example count reads zero', () => {
		setupPacksPage({ packs: [buildStandardsPackListing({ built: true, totals: { withFixtures: 0 } })] });

		const badge = screen.getByText('shipped without its fixtures');

		expect(badge).toBeInTheDocument();
	});

	test('stays silent about fixtures on a pack that still has its own', () => {
		setupPacksPage({ packs: [buildStandardsPackListing({ built: false })] });

		const badge = screen.queryByText('shipped without its fixtures');

		expect(badge).not.toBeInTheDocument();
	});

	test("points the pack's name at its own page, which is where its rules and the code behind them are", () => {
		setupPacksPage({ packs: [buildStandardsPackListing({ name: 'acme-house-rules' })] });

		const link = screen.getByRole('link', { name: 'acme-house-rules' });

		expect(link).toHaveAttribute('href', '/standards/acme-house-rules');
	});

	test("prints the pack's own sentence about itself when it states one", () => {
		setupPacksPage({ packs: [buildStandardsPackListing({ description: 'Rules the platform team enforces everywhere.' })] });

		const description = screen.getByText('Rules the platform team enforces everywhere.');

		expect(description).toBeInTheDocument();
	});

	test('shows nothing in its place when the pack states none, rather than an empty line', () => {
		setupPacksPage({ packs: [buildStandardsPackListing({ overrides: { description: undefined } })] });

		const card = screen.getByRole('heading', { level: 2, name: 'lightsout-defaults' }).closest('section');

		expect(card?.querySelectorAll('p')).toHaveLength(0);
	});

	test('labels the four counts a reader can act on, leaving out judgment as rules minus checked', () => {
		setupPacksPage({ packs: [buildStandardsPackListing({ totals: { rules: 10, checked: 4, judgment: 6, documents: 3, withFixtures: 2 } })] });

		const labels = screen.getAllByRole('term').map((term) => term.textContent);

		expect(labels).toStrictEqual(['rules', 'checked by code', 'documents', 'with examples']);
	});

	test('reports the totals the engine supplied rather than counting for itself', () => {
		setupPacksPage({ packs: [buildStandardsPackListing({ totals: { rules: 10, checked: 4, judgment: 6, documents: 3, withFixtures: 2 } })] });

		const values = screen.getAllByRole('definition').map((value) => value.textContent);

		expect(values).toStrictEqual(['10', '4', '3', '2']);
	});

	test("tags the channels the pack's documents declare, so a reader sees what it covers", () => {
		setupPacksPage({ packs: [buildStandardsPackListing({ channels: ['base', 'nestjs', 'react'] })] });

		const channels = screen.getAllByText(/^(base|nestjs|react)$/).map((tag) => tag.textContent);

		expect(channels).toStrictEqual(['base', 'nestjs', 'react']);
	});

	test('draws no channel tags at all for a pack whose documents declare none', () => {
		setupPacksPage({ packs: [buildStandardsPackListing({ channels: [] })] });

		const channels = screen.queryByText('base');

		expect(channels).not.toBeInTheDocument();
	});
});

describe('PacksPage write-your-own card', () => {
	test('closes the page with it, after the packs a reader has just read about', () => {
		setupPacksPage({
			packs: [buildStandardsPackListing(), buildStandardsPackListing({ name: 'acme-house-rules', isDefault: false })],
		});

		const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);

		expect(headings).toStrictEqual(['Standards packs', 'Use these packs', 'lightsout-defaults', 'acme-house-rules', 'Write your own']);
	});

	test('leaves it off the empty page, where there are no bundled packs for a reader to sit their own beside', () => {
		setupPacksPage({ packs: [] });

		const heading = screen.queryByRole('heading', { name: 'Write your own' });

		expect(heading).not.toBeInTheDocument();
	});

	test('draws the folder a pack actually is, down to the file that holds one rule', () => {
		setupPacksPage();

		const shape = screen.getByText(/lightsout-standards\.json/);

		expect(shape.textContent).toContain('05-loose-file/rule.md');
	});

	test('sends a reader to the configuration doc, which is where a pack is pointed at', () => {
		setupPacksPage();

		const link = screen.getByRole('link', { name: 'Configuration' });

		expect(link).toHaveAttribute('href', '/docs/configuration');
	});

	test('sends the second link to the section of that doc about adding your own, not to its top', () => {
		setupPacksPage();

		const link = screen.getByRole('link', { name: 'Adding your standards' });

		expect(link).toHaveAttribute('href', '/docs/configuration#adding-your-standards');
	});

	test('points at the contracts source on GitHub, in a new tab, because this app serves no page for it', () => {
		setupPacksPage();

		const link = screen.getByRole('link', { name: /What a check receives/ });

		expect(link).toHaveAttribute('href', 'https://github.com/dc-devs/lightsout/tree/main/packages/standards-contracts');
		expect(link).toHaveAttribute('target', '_blank');
		expect(link).toHaveAttribute('rel', 'noreferrer');
	});
});
