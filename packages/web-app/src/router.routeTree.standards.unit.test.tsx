import { describe, expect, jest, test } from '@jest/globals';
import type { StandardsPackListing, StandardsPackRuleView, StandardsPackView } from '@lightsout/engine';
import { StandardsSeverity } from '@lightsout/engine/contracts';
import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { fireEvent, screen, within } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { routeTree } from '#src/routeTree.gen.ts';
import { buildStandardsPackListing } from '#tests/helpers/buildStandardsPackListing.ts';
import { buildStandardsPackRuleListing } from '#tests/helpers/buildStandardsPackRuleListing.ts';
import { buildStandardsPackRuleView } from '#tests/helpers/buildStandardsPackRuleView.ts';
import { buildStandardsPackView } from '#tests/helpers/buildStandardsPackView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The route tree loads every route module and everything those modules render,
// and the pack routes reach the engine's filesystem reader at the far end of
// that chain. Stubbing the reader keeps the whole graph off disk.
const mockListPacks = jest.fn<() => Promise<StandardsPackListing[]>>();
const mockGetPack = jest.fn<(params: { name: string }) => Promise<StandardsPackView>>();
const mockGetPackRule = jest.fn<(params: { name: string; rule: string }) => Promise<StandardsPackRuleView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	// Everything else is the real thing: the frozen demo runs Home reads are
	// committed JSON rather than disk this test has to fake.
	...jest.requireActual<typeof import('#src/lightsout/index.ts')>('#src/lightsout/index.ts'),
	getReader: () => ({
		listPacks: () => mockListPacks(),
		getPack: (params: { name: string }) => mockGetPack(params),
		getPackRule: (params: { name: string; rule: string }) => mockGetPackRule(params),
	}),
}));
// -------------------------
// Only the pieces that need a live router around them are stood in for, so a
// single route's component can be rendered on its own. Everything else — above
// all `createRouter` and the `createFileRoute` calls the tree is assembled from
// — stays real, since the tree is what is under test here.
const mockNavigate = jest.fn<(options: { search: Record<string, unknown>; replace: boolean }) => void>();

jest.mock('@tanstack/react-router', () => {
	const actual = jest.requireActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');

	return {
		...actual,
		Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
			<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
				{children}
			</a>
		),
		// The pack page writes its filters into the URL. Outside a live router
		// there is nothing to navigate, and what the route decides — which keys it
		// writes, and that it replaces rather than pushes — is what this file reads.
		useNavigate: () => mockNavigate,
	};
});
// -------------------------

/** Whatever path parameters a standards-zone route carries — both optional, so one interface serves all three. */
interface PageParams {
	pack?: string;
	rule?: string;
}

/**
 * One of the tree's standards-zone file routes, narrowed to what this file
 * reads.
 *
 * The router types these against its own deeply generic route shapes; restating
 * those here would be noise rather than safety, so each entry names only the
 * argument the app's own code passes it and the value it hands back.
 */
interface FilePage {
	options: {
		component: ComponentType;
		notFoundComponent: ComponentType;
		loader: (input: { context: { queryClient: QueryClient }; params?: PageParams }) => Promise<void>;
		head: (input: { params: PageParams }) => { meta: { title: string }[] };
		validateSearch: (search: Record<string, unknown>) => Record<string, unknown>;
	};
	useParams: () => PageParams;
	useSearch: () => Record<string, unknown>;
}

const setupRouteTree = () => {
	const packs = [buildStandardsPackListing()];
	// Neither rule is one the showcase strip leads with, and the two differ in
	// who enforces them — so the pack page under test carries the enforced-by
	// toggles this file drives, and no strip fires a query of its own.
	const pack = buildStandardsPackView({
		rules: [
			buildStandardsPackRuleListing({ id: 'crowded-folder', summary: 'a folder holding too many things' }),
			buildStandardsPackRuleListing({ id: 'casing', summary: 'a name spelled in the wrong case', checked: false, defaultSeverity: StandardsSeverity.Advisory }),
		],
	});

	mockListPacks.mockResolvedValue(packs);
	mockGetPack.mockResolvedValue(pack);
	mockGetPackRule.mockImplementation(({ rule }) => Promise.resolve(buildStandardsPackRuleView({ id: rule })));

	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createRouter({ routeTree, context: { queryClient } });
	const pages = (router as unknown as { routesById: Record<string, FilePage> }).routesById;

	return { pack, packs, pages, queryClient };
};

/** Any route's loader, with the client it fills and the data the reader will answer it with. */
const setupLoader = ({ id }: { id: string }) => {
	const { pack, packs, pages, queryClient } = setupRouteTree();

	return { loader: pages[id].options.loader, pack, packs, queryClient };
};

const setupPacksPage = ({ packs = [buildStandardsPackListing()] }: { packs?: StandardsPackListing[] } = {}) => {
	const { pages } = setupRouteTree();
	const Page = pages['/_site/standards/'].options.component;

	renderWithQueryClient({ ui: <Page />, seed: [{ queryKey: [QueryKey.Packs], data: packs }] });
};

/**
 * The pack detail route, rendered for one pack and one set of URL filters.
 *
 * `Route.useParams()` and `Route.useSearch()` read the match a live router is
 * showing, so both come from spies rather than from a router driven to the path
 * — which is the routing library's behaviour, not this route's.
 */
const setupPackDetailPage = ({ pack = 'lightsout-defaults', search = {} }: { pack?: string; search?: Record<string, unknown> } = {}) => {
	const { pack: packView, pages } = setupRouteTree();
	const route = pages['/_site/standards/$pack/'];
	jest.spyOn(route, 'useParams').mockReturnValue({ pack });
	jest.spyOn(route, 'useSearch').mockReturnValue(search);
	const Page = route.options.component;

	renderWithQueryClient({ ui: <Page />, seed: [{ queryKey: [QueryKey.Pack, pack], data: packView }] });
};

/** The same route's answer for a name no pack this build loads carries. */
const setupMissingPackPage = ({ pack = 'no-such-pack' }: { pack?: string } = {}) => {
	const { pages } = setupRouteTree();
	const route = pages['/_site/standards/$pack/'];
	jest.spyOn(route, 'useParams').mockReturnValue({ pack });
	const Page = route.options.notFoundComponent;

	renderWithQueryClient({ ui: <Page /> });
};

/** The rule page, for one address. */
const setupRuleDetailPage = ({ pack = 'lightsout-defaults', rule = 'type-assertion' }: { pack?: string; rule?: string } = {}) => {
	const { pack: packView, pages } = setupRouteTree();
	const route = pages['/_site/standards/$pack/$rule'];
	jest.spyOn(route, 'useParams').mockReturnValue({ pack, rule });
	const Page = route.options.component;

	renderWithQueryClient({
		ui: <Page />,
		seed: [
			{ queryKey: [QueryKey.Pack, pack], data: packView },
			{ queryKey: [QueryKey.PackRule, pack, rule], data: buildStandardsPackRuleView({ id: rule }) },
		],
	});
};

/** The same route's answer for a rule the pack does not carry. */
const setupMissingRulePage = ({ pack = 'lightsout-defaults', rule = 'one-exported-function-per-file' }: { pack?: string; rule?: string } = {}) => {
	const { pages } = setupRouteTree();
	const route = pages['/_site/standards/$pack/$rule'];
	jest.spyOn(route, 'useParams').mockReturnValue({ pack, rule });
	const Page = route.options.notFoundComponent;

	renderWithQueryClient({ ui: <Page /> });
};

// The sell zone's three standards routes, split out of the tree's own scenario
// suite by concern rather than by size: what `/standards/`, `/standards/$pack/`
// and `/standards/$pack/$rule` serve, and what the pack route does with the
// query string it owns.
describe('routeTree standards routes', () => {
	test('the packs route lists the standards packs this build can see', () => {
		setupPacksPage({ packs: [buildStandardsPackListing({ name: 'acme-house-rules' })] });

		const card = screen.getByRole('heading', { level: 2, name: 'acme-house-rules' });

		expect(card).toBeInTheDocument();
	});

	test('the packs route says so plainly when no pack could be found, rather than erroring', () => {
		setupPacksPage({ packs: [] });

		const notice = screen.getByText('No standards pack could be found from here.');

		expect(notice).toBeInTheDocument();
	});

	test('the packs route warms its own list before the page renders', async () => {
		const { loader, packs, queryClient } = setupLoader({ id: '/_site/standards/' });

		await loader({ context: { queryClient } });

		expect(queryClient.getQueryData([QueryKey.Packs])).toStrictEqual(packs);
	});

	test('the pack route renders the pack whose name the path carries', () => {
		setupPackDetailPage();

		const heading = screen.getByRole('heading', { level: 1, name: 'lightsout-defaults' });

		expect(heading).toBeInTheDocument();
	});

	test('the pack route names the tab from the path alone, before any query has resolved', () => {
		const { pages } = setupRouteTree();

		const head = pages['/_site/standards/$pack/'].options.head({ params: { pack: 'acme-house-rules' } });

		expect(head.meta).toStrictEqual([{ title: 'acme-house-rules — standards pack' }]);
	});

	test('the pack route warms the pack and every rule the showcase strip leads with', async () => {
		const { loader, pack, queryClient } = setupLoader({ id: '/_site/standards/$pack/' });

		await loader({ context: { queryClient }, params: { pack: 'lightsout-defaults' } });

		const showcase = ['type-assertion', 'object-args', 'bare-string-union', 'explicit-return-type', 'multi-export', 'test-shared-let'].map(
			(rule) => queryClient.getQueryData<StandardsPackRuleView>([QueryKey.PackRule, 'lightsout-defaults', rule])?.id,
		);

		expect(queryClient.getQueryData([QueryKey.Pack, 'lightsout-defaults'])).toStrictEqual(pack);
		expect(showcase).toStrictEqual(['type-assertion', 'object-args', 'bare-string-union', 'explicit-return-type', 'multi-export', 'test-shared-let']);
	});

	test('the pack route treats a showcase rule that will not load as no error at all, since the strip skips it', async () => {
		const { loader, queryClient } = setupLoader({ id: '/_site/standards/$pack/' });
		mockGetPackRule.mockRejectedValue(new Error('the fixture folder is unreadable'));

		await expect(loader({ context: { queryClient }, params: { pack: 'lightsout-defaults' } })).resolves.toBeUndefined();
	});

	test("the pack route reads the URL's own words and hands the page the filter they mean", () => {
		setupPackDetailPage({ search: { enforcedBy: 'judgment' } });

		const toggle = within(screen.getByRole('group', { name: 'enforced by' })).getByRole('button', { name: 'judgment' });

		expect(toggle).toHaveAttribute('aria-pressed', 'true');
	});

	test('the pack route writes a filter change back as those same words, replacing the URL rather than pushing it', () => {
		setupPackDetailPage();

		fireEvent.click(within(screen.getByRole('group', { name: 'enforced by' })).getByRole('button', { name: 'judgment' }));

		expect(mockNavigate).toHaveBeenCalledWith({
			search: { set: undefined, channel: undefined, enforcedBy: 'judgment', severity: undefined, text: undefined },
			replace: true,
		});
	});

	test('the pack route writes the other half of that word the same way', () => {
		setupPackDetailPage();

		fireEvent.click(within(screen.getByRole('group', { name: 'enforced by' })).getByRole('button', { name: 'code' }));

		expect(mockNavigate).toHaveBeenCalledWith({
			search: { set: undefined, channel: undefined, enforcedBy: 'code', severity: undefined, text: undefined },
			replace: true,
		});
	});

	test('the pack route reads that word back as the filter it means', () => {
		setupPackDetailPage({ search: { enforcedBy: 'code' } });

		const toggle = within(screen.getByRole('group', { name: 'enforced by' })).getByRole('button', { name: 'code' });

		expect(toggle).toHaveAttribute('aria-pressed', 'true');
	});

	test('the pack route drops a filter key from the URL when the toggle already carrying it is pressed again', () => {
		setupPackDetailPage({ search: { enforcedBy: 'judgment' } });

		fireEvent.click(within(screen.getByRole('group', { name: 'enforced by' })).getByRole('button', { name: 'judgment' }));

		expect(mockNavigate).toHaveBeenCalledWith({
			search: { set: undefined, channel: undefined, enforcedBy: undefined, severity: undefined, text: undefined },
			replace: true,
		});
	});

	test('the pack route carries the query values it is not changing through a change to one of them', () => {
		setupPackDetailPage({ search: { severity: 'advisory', text: 'cas' } });

		fireEvent.click(within(screen.getByRole('group', { name: 'enforced by' })).getByRole('button', { name: 'code' }));

		expect(mockNavigate).toHaveBeenCalledWith({
			search: { set: undefined, channel: undefined, enforcedBy: 'code', severity: 'advisory', text: 'cas' },
			replace: true,
		});
	});

	test('the pack route leaves both toggles alone when the URL narrows on neither', () => {
		setupPackDetailPage();

		const toggle = within(screen.getByRole('group', { name: 'enforced by' })).getByRole('button', { name: 'code' });

		expect(toggle).toHaveAttribute('aria-pressed', 'false');
	});

	test('the pack route keeps a query value its vocabulary knows', () => {
		const { pages } = setupRouteTree();

		const search = pages['/_site/standards/$pack/'].options.validateSearch({ set: 'tests', severity: 'advisory', text: 'cast' });

		expect(search).toStrictEqual({ set: 'tests', channel: undefined, enforcedBy: undefined, severity: 'advisory', text: 'cast' });
	});

	test('the pack route ignores a query value outside that vocabulary, rather than filtering to nothing', () => {
		const { pages } = setupRouteTree();

		const search = pages['/_site/standards/$pack/'].options.validateSearch({ set: 'prose', enforcedBy: 'vibes', text: '' });

		expect(search).toStrictEqual({ set: undefined, channel: undefined, enforcedBy: undefined, severity: undefined, text: undefined });
	});

	test('the pack route says which name nothing this build loads answers to', () => {
		setupMissingPackPage({ pack: 'no-such-pack' });

		const notice = screen.getByText(/no-such-pack/);

		expect(notice).toBeInTheDocument();
	});

	test('the rule route renders the rule whose address the path carries', () => {
		setupRuleDetailPage();

		const heading = screen.getByRole('heading', { level: 1, name: 'type-assertion' });

		expect(heading).toBeInTheDocument();
	});

	test('the rule route names the tab from the path alone too', () => {
		const { pages } = setupRouteTree();

		const head = pages['/_site/standards/$pack/$rule'].options.head({ params: { pack: 'lightsout-defaults', rule: 'object-args' } });

		expect(head.meta).toStrictEqual([{ title: 'object-args — lightsout-defaults' }]);
	});

	test('the rule route warms both the rule it shows and the pack it names above it', async () => {
		const { loader, pack, queryClient } = setupLoader({ id: '/_site/standards/$pack/$rule' });

		await loader({ context: { queryClient }, params: { pack: 'lightsout-defaults', rule: 'type-assertion' } });

		expect(queryClient.getQueryData([QueryKey.PackRule, 'lightsout-defaults', 'type-assertion'])).toStrictEqual(
			buildStandardsPackRuleView({ id: 'type-assertion' }),
		);
		expect(queryClient.getQueryData([QueryKey.Pack, 'lightsout-defaults'])).toStrictEqual(pack);
	});

	// The page reads the pack half of the address as well as the rule half, and
	// the trail is where a reader sees which pack they landed in — so a route
	// handing the screen the wrong half would show up here rather than nowhere.
	test('the rule route puts the pack the path names in the trail above the rule, pointing back at that pack', () => {
		setupRuleDetailPage({ pack: 'lightsout-defaults', rule: 'type-assertion' });

		const crumb = within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'lightsout-defaults' });

		expect(crumb).toHaveAttribute('href', '/standards/lightsout-defaults');
	});

	test('the rule route names both halves of an address that leads nowhere', () => {
		setupMissingRulePage({ rule: 'one-exported-function-per-file' });

		const notice = screen.getByText(/one-exported-function-per-file/);

		expect(notice).toBeInTheDocument();
	});

	// Either half can be the wrong one, so the pack is named as plainly as the
	// rule — a reader who mistyped the pack learns that from the same line.
	test('the rule route names the pack half of that address too', () => {
		setupMissingRulePage({ pack: 'acme-house-rules', rule: 'one-exported-function-per-file' });

		const notice = screen.getByText('acme-house-rules');

		expect(notice).toBeInTheDocument();
	});
});
