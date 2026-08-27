import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { type RunListing, type StandardsPackListing, StandardsPackRuleNotFoundError, type StandardsPackRuleView } from '@lightsout/engine';
import { screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { Home } from '#src/features/home/screens/Home/Home.tsx';
import { buildStandardsPackListing } from '#tests/helpers/buildStandardsPackListing.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// Home reads one query it never warms — the default pack's three numbers — and
// the showcase cards read three more. Seeded, they resolve; unseeded, the reader
// behind them would walk the real filesystem, so it is stubbed with promises
// that never settle. That is also the honest state: a pack that will not load is
// exactly what this page has to survive.
//
// The rule read is a function rather than one more promise that never settles,
// because a rule renamed since the showcase list was written is the other state
// a card has to survive, and only a rejection reaches it.
//
// The frozen listings are a function rather than the committed rows, so one test
// can ask what the page does with a slot no run fills. Every other export is the
// real thing, the demo runs included: committed JSON, not disk a test has to fake.
const mockGetDemoRunListings = jest.fn<() => RunListing[]>();
const mockGetPackRule = jest.fn<(params: { name: string; rule: string }) => Promise<StandardsPackRuleView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	...jest.requireActual<typeof import('#src/lightsout/index.ts')>('#src/lightsout/index.ts'),
	getReader: () => ({
		listPacks: () => new Promise(() => {}),
		getPackRule: (params: { name: string; rule: string }) => mockGetPackRule(params),
	}),
	getDemoRunListings: () => mockGetDemoRunListings(),
}));
// -------------------------
// The repo question is left unseeded in one test below, because the first frame
// — before it answers — is a state the proof link needs a label for. Stubbed
// with a promise that never settles rather than left to walk the real
// filesystem, which on this machine would find this very repo.
jest.mock('#src/features/app/serverFns/index.ts', () => ({ getRepoRootServerFn: () => new Promise(() => {}) }));
// -------------------------
// The proof section's frame arrives as its own chunk, so what it renders lands
// in this page whenever that import happens to resolve — which is after the
// first test, not the first render. Its own suite covers what it draws; here it
// stands aside so the page's own headings are the only ones on the page.
jest.mock('#src/features/home/components/DemoRunDetail.tsx', () => ({ DemoRunDetail: () => null }));
// -------------------------
// The links, which need a live router around them to resolve a path, and the
// not-found signal the pack server function raises for a rule the pack has
// dropped — with no router mounted, what matters is only that it rejects.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
	notFound: () => new Error('not found'),
}));
// -------------------------

const realRequest = globalThis.requestAnimationFrame;
const realCancel = globalThis.cancelAnimationFrame;

/** The three rows the committed fixture actually holds, which is what ships and so what the page renders by default. */
const frozenListings = jest.requireActual<typeof import('#src/lightsout/index.ts')>('#src/lightsout/index.ts').getDemoRunListings();

interface SetupParams {
	/** The frozen rows the proof section picks its three panels from. */
	listings?: RunListing[];
	/** `false` leaves the repo question unseeded, which is the query still in flight. */
	isRepoAnswered?: boolean;
	/** The pack rows the standards section reads. Left out is the query still in flight — a public build's first frame, and its last if no pack loads. */
	packs?: StandardsPackListing[];
	/** `true` makes every showcased rule one the pack no longer carries, which is a rename since the list was written. */
	isShowcaseMissing?: boolean;
}

/**
 * The whole page with an empty cache — which is what a build holding no repo
 * actually renders, since Home warms nothing and suspends on nothing.
 *
 * The animation loops are driven by hand for the reason the sprawl suites give:
 * jsdom's own frames land outside React's act boundary.
 */
const setupHome = ({ listings = frozenListings, isRepoAnswered = true, packs, isShowcaseMissing = false }: SetupParams = {}) => {
	Object.assign(globalThis, { requestAnimationFrame: () => 0, cancelAnimationFrame: () => undefined });
	mockGetDemoRunListings.mockReturnValue(listings);
	// Built at call time rather than handed over as one settled promise, so a
	// rejection is never left without a handler between arrangement and render.
	mockGetPackRule.mockImplementation(({ name, rule }) =>
		isShowcaseMissing ? Promise.reject(new StandardsPackRuleNotFoundError({ name, rule })) : new Promise<StandardsPackRuleView>(() => {}),
	);

	renderWithQueryClient({
		ui: <Home />,
		seed: [
			...(isRepoAnswered ? [{ queryKey: [QueryKey.RepoRoot], data: { repoRoot: undefined } }] : []),
			...(packs === undefined ? [] : [{ queryKey: [QueryKey.Packs], data: packs }]),
		],
	});
};

/** The standards section's own element, so a claim about its cards is not a claim about the whole page. */
const findStandardsSection = () => screen.getByRole('heading', { level: 2, name: 'Ship with ours. Mix in yours.' }).closest('section');

afterEach(() => {
	Object.assign(globalThis, { requestAnimationFrame: realRequest, cancelAnimationFrame: realCancel });
});

describe('Home', () => {
	test('renders with nothing in the cache, because a public build has nothing to warm it with', () => {
		setupHome();

		// The headline's key word sits in its own gradient span, which the
		// accessible-name rules join with a space — the text is what a reader sees.
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Stop the slop.');
	});

	test('composes all nine sections, in the order a reader meets them', () => {
		setupHome();

		const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);

		expect(headings).toStrictEqual([
			'Name the slop',
			'Humans decide. Agents execute. Your commands decide when it’s done.',
			'Five things nobody else does',
			'Files and folders have caps. Past the cap, they graduate.',
			'Bring your own standards',
			'Ship with ours. Mix in yours.',
			'Not just new features',
			'Proof',
			'The model can claim success. Lightsout requires evidence.',
			'Start with three gates and one command.',
		]);
	});

	test('ends on the install line it opened with', () => {
		setupHome();

		expect(screen.getAllByText('/plugin marketplace add dc-devs/lightsout')).toHaveLength(2);
	});

	test('sends a reader from each burn-down card to that command’s own manual page, rather than off the site to a skill file', () => {
		setupHome();

		const manuals = screen.getAllByRole('link', { name: 'What it does →' });

		expect(manuals.map((manual) => manual.getAttribute('href'))).toStrictEqual(['/commands/refactor', '/commands/test-coverage-to-threshold']);
	});

	test('offers this project’s own runs while the repo question is still in flight, which is the label a public build keeps', () => {
		setupHome({ isRepoAnswered: false });

		const browse = screen.getByRole('link', { name: 'Browse lightsout’s own runs →' });

		expect(browse).toHaveAttribute('href', '/repo/runs');
	});

	test('paints the default pack’s numbers while its rule examples are still being read', () => {
		setupHome({ packs: [buildStandardsPackListing({ overrides: { isDefault: true } })] });

		const standards = findStandardsSection();

		expect(standards).toHaveTextContent('111 rules · 52 enforced by code · 111 with a pass and a fail example');
		// Two placeholders per showcased rule — its one-line argument and the
		// fixture pair under it — for each of the three the section leads with.
		expect(standards?.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(6);
	});

	test('drops a showcased rule the pack no longer carries rather than the section it sits in', async () => {
		setupHome({ packs: [buildStandardsPackListing({ overrides: { isDefault: true } })], isShowcaseMissing: true });

		const standards = findStandardsSection();
		await waitFor(() => expect(standards?.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0));

		expect(standards).toHaveTextContent('111 rules · 52 enforced by code · 111 with a pass and a fail example');
		expect(screen.queryByRole('link', { name: 'Read the rule →' })).not.toBeInTheDocument();
	});

	test('drops a panel whose slot no frozen run fills, rather than framing an empty page', () => {
		setupHome({ listings: frozenListings.filter((listing) => listing.pipeline !== 'refactor') });

		// Every tab on the page, because the fix section has three of its own above
		// this one — the two claims below are about which of the proof panels survive.
		const panels = screen.getAllByRole('tab').map((tab) => tab.textContent);

		expect(panels).not.toContain('A refactor burn-down');
		expect(panels).toEqual(expect.arrayContaining(['A clean run', 'A run that stopped']));
	});
});
