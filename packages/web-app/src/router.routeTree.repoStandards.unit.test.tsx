import { describe, expect, jest, test } from '@jest/globals';
import type { StandardsView } from '@lightsout/engine';
import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { routeTree } from '#src/routeTree.gen.ts';
import { buildStandardsFinding } from '#tests/helpers/buildStandardsFinding.ts';
import { buildStandardsRuleView } from '#tests/helpers/buildStandardsRuleView.ts';
import { buildStandardsView } from '#tests/helpers/buildStandardsView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The page reads its rule filter out of the URL and writes changes back, and
// outside a live router there is nothing to read from or navigate with. What the
// page reads is whatever this route's own `validateSearch` returned, so the
// route's vocabulary is what reaches the table. Everything else about the router
// — above all `createRouter` and the `createFileRoute` calls the tree is
// assembled from — stays real, since the tree is what is under test here.
const mockNavigate = jest.fn<(options: { search: Record<string, unknown>; replace: boolean }) => void>();
const mockUseSearch = jest.fn<() => { rule?: string }>();

jest.mock('@tanstack/react-router', () => {
	const actual = jest.requireActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');

	return { ...actual, useSearch: () => mockUseSearch(), useNavigate: () => mockNavigate };
});
// -------------------------

/**
 * The standards file route, narrowed to what this file reads.
 *
 * The router types these against its own deeply generic route shapes; restating
 * those here would be noise rather than safety, so each entry names only the
 * argument the app's own code passes it and the value it hands back.
 */
interface FilePage {
	options: {
		component: ComponentType;
		head: () => { meta: { title: string }[] };
		validateSearch: (search: Record<string, unknown>) => { rule?: string };
	};
}

const setupStandardsRoute = () => {
	// The tree's root declares a query client in its context, so one has to exist
	// for the router to be built at all. Nothing this file drives reads it: the
	// page's own data is seeded into the cache the render helper creates.
	const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
	const route = (router as unknown as { routesById: Record<string, FilePage> }).routesById['/repo/standards'];

	return { head: route.options.head, route, validateSearch: route.options.validateSearch };
};

interface PageParams {
	/** The query string as a URL wrote it, before the route has had a say in it. */
	search?: Record<string, unknown>;
	overrides?: Partial<StandardsView>;
}

/**
 * The route's page, rendered against a query string this route validated.
 *
 * The URL goes through the real `validateSearch` on its way in, so what these
 * tests read off the screen is the route's own answer for that URL rather than a
 * filter handed straight to the component.
 */
const setupStandardsPage = ({ search = {}, overrides = {} }: PageParams = {}) => {
	const { route, validateSearch } = setupStandardsRoute();
	const Page = route.options.component;

	mockUseSearch.mockReturnValue(validateSearch(search));
	renderWithQueryClient({ ui: <Page />, seed: [{ queryKey: [QueryKey.Standards], data: buildStandardsView({ overrides }) }] });
};

/** Two findings under two rules, so a narrowed table can be told from an unnarrowed one. */
const twoRules: Partial<StandardsView> = {
	rules: [buildStandardsRuleView({ rule: 'size-file' }), buildStandardsRuleView({ rule: 'duplicate-code-block' })],
	findings: [
		buildStandardsFinding({ rule: 'size-file', detail: 'the long file' }),
		buildStandardsFinding({ rule: 'duplicate-code-block', paths: ['b/two.ts'], detail: 'the copied block' }),
	],
};

// The tree this file drives lives in `routeTree.gen.ts`, which TanStack Router
// writes and the repo lists as generated output — so it is not a subject a test
// may be named after. `router.tsx` is the tree's only consumer, which makes this
// a scenario suite on the router, split from the tree's own by concern: what
// `/repo/standards` will accept from a query string, and what a reader sees for
// it.
describe('routeTree repo standards route', () => {
	test('keeps the rule a link narrowed the page to, which is what `?rule=` deep links are for', () => {
		const { validateSearch } = setupStandardsRoute();

		const search = validateSearch({ rule: 'size-file' });

		expect(search).toStrictEqual({ rule: 'size-file' });
	});

	test('reads a query string that names no rule as the page’s own "all rules"', () => {
		const { validateSearch } = setupStandardsRoute();

		const search = validateSearch({});

		expect(search).toStrictEqual({ rule: undefined });
	});

	// A cleared filter leaves `?rule=` behind on some links rather than dropping
	// the key, and an empty rule id matches no finding at all — so it has to mean
	// the same thing as no key, or the page would be stuck showing nothing.
	test('reads an empty rule as no filter, rather than as a rule nothing is open under', () => {
		const { validateSearch } = setupStandardsRoute();

		const search = validateSearch({ rule: '' });

		expect(search).toStrictEqual({ rule: undefined });
	});

	// A repeated key arrives as an array, which is the one shape a hand-written
	// URL reaches the page with that the filter could not compare against.
	test('drops a rule that arrived as something other than one word', () => {
		const { validateSearch } = setupStandardsRoute();

		const search = validateSearch({ rule: ['size-file', 'duplicate-code-block'] });

		expect(search).toStrictEqual({ rule: undefined });
	});

	test('carries nothing else a URL happens to say, since the page has one key', () => {
		const { validateSearch } = setupStandardsRoute();

		const search = validateSearch({ rule: 'size-file', folder: 'packages/engine', depth: 3 });

		expect(search).toStrictEqual({ rule: 'size-file' });
	});

	test('names the tab before any of that view has resolved', () => {
		const { head } = setupStandardsRoute();

		const documentHead = head();

		expect(documentHead.meta).toStrictEqual([{ title: 'Standards' }]);
	});

	test('lands a reader who followed a `?rule=` link on that rule’s rows alone', () => {
		setupStandardsPage({ overrides: twoRules, search: { rule: 'size-file' } });

		expect(screen.getByText('the long file')).toBeInTheDocument();
		expect(screen.queryByText('the copied block')).not.toBeInTheDocument();
	});

	test('shows every finding for a URL whose rule it dropped, rather than an empty table', () => {
		setupStandardsPage({ overrides: twoRules, search: { rule: '' } });

		expect(screen.getByText('the long file')).toBeInTheDocument();
		expect(screen.getByText('the copied block')).toBeInTheDocument();
	});
});
