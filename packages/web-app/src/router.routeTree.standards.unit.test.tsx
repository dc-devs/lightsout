import { describe, expect, jest, test } from '@jest/globals';
import { toStandardsPackRuleView, toStandardsPackView } from '@lightsout/engine';
import { QueryClient } from '@tanstack/react-query';
import { createRouter, isNotFound } from '@tanstack/react-router';
import { fireEvent, screen, within } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { getDefaultPackBundle } from '#src/lightsout/index.ts';
import { routeTree } from '#src/routeTree.gen.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
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
		// The rule-set page writes its filters into the URL. Outside a live router
		// there is nothing to navigate, and what the route decides — which keys it
		// writes, and that it replaces rather than pushes — is what this file reads.
		useNavigate: () => mockNavigate,
	};
});
// -------------------------

/** Whatever path parameters a standards-zone route carries — both optional, so one interface serves all three. */
interface PageParams {
	ruleSet?: string;
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
		loader: (input: { context: { queryClient: QueryClient }; params?: PageParams }) => Promise<unknown>;
		head: (input: { params: PageParams }) => { meta: { title: string }[] };
		validateSearch: (search: Record<string, unknown>) => Record<string, unknown>;
	};
	useParams: () => PageParams;
	useSearch: () => Record<string, unknown>;
}

/**
 * The tree over the real shipped pack: these pages document the default pack
 * bundled into the app, so the tests read it rather than a stand-in.
 */
const setupRouteTree = () => {
	const pack = toStandardsPackView({ bundle: getDefaultPackBundle() });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createRouter({ routeTree, context: { queryClient } });
	const pages = (router as unknown as { routesById: Record<string, FilePage> }).routesById;

	return { pack, pages, queryClient };
};

/** Any route's loader, with the client it fills. */
const setupLoader = ({ id }: { id: string }) => {
	const { pack, pages, queryClient } = setupRouteTree();

	return { loader: pages[id].options.loader, pack, queryClient };
};

const setupPacksPage = () => {
	const { pack, pages } = setupRouteTree();
	const Page = pages['/_site/standards-packs/'].options.component;

	renderWithQueryClient({ ui: <Page />, seed: [{ queryKey: [QueryKey.DefaultPack], data: pack }] });
};

/**
 * The rule-set route, rendered for one set and one set of URL filters.
 *
 * `Route.useParams()` and `Route.useSearch()` read the match a live router is
 * showing, so both come from spies rather than from a router driven to the path
 * — which is the routing library's behaviour, not this route's.
 */
const setupRuleSetPage = ({ search = {} }: { search?: Record<string, unknown> } = {}) => {
	const { pack, pages } = setupRouteTree();
	const route = pages['/_site/standards-packs/$ruleSet/'];
	jest.spyOn(route, 'useParams').mockReturnValue({ ruleSet: 'typescript' });
	jest.spyOn(route, 'useSearch').mockReturnValue(search);
	const Page = route.options.component;

	renderWithQueryClient({ ui: <Page />, seed: [{ queryKey: [QueryKey.DefaultPack], data: pack }] });
};

/** The same route's answer for a set the pack does not hold. */
const setupMissingRuleSetPage = ({ ruleSet = 'vue' }: { ruleSet?: string } = {}) => {
	const { pages } = setupRouteTree();
	const route = pages['/_site/standards-packs/$ruleSet/'];
	jest.spyOn(route, 'useParams').mockReturnValue({ ruleSet });
	const Page = route.options.notFoundComponent;

	renderWithQueryClient({ ui: <Page /> });
};

/** The rule page, for one address. */
const setupRuleDetailPage = ({ rule = 'folder-size' }: { rule?: string } = {}) => {
	const { pages } = setupRouteTree();
	const route = pages['/_site/standards-packs/$ruleSet/$rule'];
	jest.spyOn(route, 'useParams').mockReturnValue({ ruleSet: 'typescript', rule });
	const Page = route.options.component;

	renderWithQueryClient({
		ui: <Page />,
		seed: [{ queryKey: [QueryKey.DefaultPackRule, rule], data: toStandardsPackRuleView({ bundle: getDefaultPackBundle(), rule }) }],
	});
};

/** The same route's answer for a rule the set does not carry. */
const setupMissingRulePage = ({ ruleSet = 'typescript', rule = 'one-exported-function-per-file' }: { ruleSet?: string; rule?: string } = {}) => {
	const { pages } = setupRouteTree();
	const route = pages['/_site/standards-packs/$ruleSet/$rule'];
	jest.spyOn(route, 'useParams').mockReturnValue({ ruleSet, rule });
	const Page = route.options.notFoundComponent;

	renderWithQueryClient({ ui: <Page /> });
};

/** Clicks one of the kind-of-check switch's options by its label. */
const pressCheckKind = ({ label }: { label: string }) =>
	fireEvent.click(within(screen.getByRole('group', { name: 'Kind of check' })).getByRole('button', { name: label }));

// The sell zone's three standards routes: what `/standards-packs/`,
// `/standards-packs/$ruleSet/` and `/standards-packs/$ruleSet/$rule` serve, and
// what the rule-set route does with the query string it owns.
describe('routeTree standards routes', () => {
	test('the packs route shows a card for each set of rules the shipped pack holds', () => {
		setupPacksPage();

		expect(screen.getByRole('heading', { level: 3, name: 'TypeScript' })).toBeInTheDocument();
	});

	test('the packs route warms its own list before the page renders', async () => {
		const { loader, pack, queryClient } = setupLoader({ id: '/_site/standards-packs/' });

		await loader({ context: { queryClient } });

		expect(queryClient.getQueryData([QueryKey.DefaultPack])).toStrictEqual(pack);
	});

	test('the rule-set route renders the set the path names, by the name a reader knows it by', () => {
		setupRuleSetPage();

		const heading = screen.getByRole('heading', { level: 1, name: 'TypeScript' });

		expect(heading).toBeInTheDocument();
	});

	test('the rule-set route names the tab from the path alone, before any query has resolved', () => {
		const { pages } = setupRouteTree();

		const head = pages['/_site/standards-packs/$ruleSet/'].options.head({ params: { ruleSet: 'react' } });

		expect(head.meta).toStrictEqual([{ title: 'react rules — Standards Packs' }]);
	});

	test('the rule-set route warms the shipped pack before the page renders', async () => {
		const { loader, pack, queryClient } = setupLoader({ id: '/_site/standards-packs/$ruleSet/' });

		await loader({ context: { queryClient }, params: { ruleSet: 'typescript' } });

		expect(queryClient.getQueryData([QueryKey.DefaultPack])).toStrictEqual(pack);
	});

	test('the rule-set route treats a set the pack does not hold as a missing address, not an empty page', async () => {
		const { loader, queryClient } = setupLoader({ id: '/_site/standards-packs/$ruleSet/' });

		const failure = await loader({ context: { queryClient }, params: { ruleSet: 'vue' } }).catch((error: unknown) => error);

		expect(isNotFound(failure)).toBe(true);
	});

	test("the rule-set route reads the URL's own words and hands the page the filter they mean", () => {
		setupRuleSetPage({ search: { check: 'agent' } });

		const option = within(screen.getByRole('group', { name: 'Kind of check' })).getByRole('button', { name: 'Agent' });

		expect(option).toHaveAttribute('aria-pressed', 'true');
	});

	test('the rule-set route writes a filter change back as those same words, replacing the URL rather than pushing it', () => {
		setupRuleSetPage();

		pressCheckKind({ label: 'Deterministic' });

		expect(mockNavigate).toHaveBeenCalledWith({ search: { check: 'deterministic', text: undefined }, replace: true });
	});

	test('the rule-set route drops the key from the URL when the reader goes back to all rules', () => {
		setupRuleSetPage({ search: { check: 'agent' } });

		pressCheckKind({ label: 'All' });

		expect(mockNavigate).toHaveBeenCalledWith({ search: { check: undefined, text: undefined }, replace: true });
	});

	test('the rule-set route carries the search through a change to the switch', () => {
		setupRuleSetPage({ search: { text: 'cas' } });

		pressCheckKind({ label: 'Agent' });

		expect(mockNavigate).toHaveBeenCalledWith({ search: { check: 'agent', text: 'cas' }, replace: true });
	});

	test('the rule-set route keeps a query value its vocabulary knows', () => {
		const { pages } = setupRouteTree();

		const search = pages['/_site/standards-packs/$ruleSet/'].options.validateSearch({ check: 'deterministic', text: 'cast' });

		expect(search).toStrictEqual({ check: 'deterministic', text: 'cast' });
	});

	test('the rule-set route ignores a query value outside that vocabulary, rather than filtering to nothing', () => {
		const { pages } = setupRouteTree();

		const search = pages['/_site/standards-packs/$ruleSet/'].options.validateSearch({ check: 'vibes', text: '' });

		expect(search).toStrictEqual({ check: undefined, text: undefined });
	});

	test('the rule-set route says which set the pack does not hold', () => {
		setupMissingRuleSetPage({ ruleSet: 'vue' });

		const notice = screen.getByText('vue');

		expect(notice).toBeInTheDocument();
	});

	test('the rule route renders the rule whose address the path carries', () => {
		setupRuleDetailPage();

		const heading = screen.getByRole('heading', { level: 1, name: 'folder-size' });

		expect(heading).toBeInTheDocument();
	});

	test('the rule route names the tab from the path alone too', () => {
		const { pages } = setupRouteTree();

		const head = pages['/_site/standards-packs/$ruleSet/$rule'].options.head({ params: { ruleSet: 'typescript', rule: 'object-args' } });

		expect(head.meta).toStrictEqual([{ title: 'object-args — typescript rules' }]);
	});

	test('the rule route warms the rule it shows', async () => {
		const { loader, queryClient } = setupLoader({ id: '/_site/standards-packs/$ruleSet/$rule' });

		await loader({ context: { queryClient }, params: { ruleSet: 'typescript', rule: 'folder-size' } });

		expect(queryClient.getQueryData<{ id: string }>([QueryKey.DefaultPackRule, 'folder-size'])?.id).toBe('folder-size');
	});

	test('the rule route treats a real rule under the wrong set as a missing address', async () => {
		const { loader, queryClient } = setupLoader({ id: '/_site/standards-packs/$ruleSet/$rule' });

		const failure = await loader({ context: { queryClient }, params: { ruleSet: 'react', rule: 'folder-size' } }).catch((error: unknown) => error);

		expect(isNotFound(failure)).toBe(true);
	});

	test('the rule route treats a rule the set does not carry as a missing address', async () => {
		const { loader, queryClient } = setupLoader({ id: '/_site/standards-packs/$ruleSet/$rule' });

		const failure = await loader({ context: { queryClient }, params: { ruleSet: 'typescript', rule: 'no-such-rule' } }).catch((error: unknown) => error);

		expect(isNotFound(failure)).toBe(true);
	});

	test('the rule route puts the set in the trail above the rule, pointing back at its rules', () => {
		setupRuleDetailPage();

		const crumb = within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'TypeScript' });

		expect(crumb).toHaveAttribute('href', '/standards-packs/typescript');
	});

	test('the rule route names both halves of an address that leads nowhere', () => {
		setupMissingRulePage({ ruleSet: 'react', rule: 'one-exported-function-per-file' });

		expect([screen.getByText('react'), screen.getByText('one-exported-function-per-file')]).toHaveLength(2);
	});
});
