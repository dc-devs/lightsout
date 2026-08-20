import { describe, expect, jest, test } from '@jest/globals';
import type { RunListing } from '@lightsout/engine';
import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { routeTree } from '#src/routeTree.gen.ts';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The route tree loads every route module and everything those modules render,
// and the runs route reaches the engine's filesystem reader at the far end of
// that chain. Stubbing the reader keeps the whole graph off disk.
const mockListRuns = jest.fn<() => Promise<RunListing[]>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ listRuns: () => mockListRuns() }),
}));
// -------------------------
// Which repo is open is answered by walking the real filesystem, so the root
// route's loader would otherwise report whatever directory Jest happened to
// start in.
const mockGetRepoRoot = jest.fn<() => string>();

jest.mock('#src/common/utils/getRepoRoot.ts', () => ({
	getRepoRoot: () => mockGetRepoRoot(),
}));
// -------------------------
// Only the pieces that need a live router around them are stood in for, so a
// single route's component can be rendered on its own. Everything else — above
// all `createRouter` and the `createFileRoute` calls the tree is assembled from
// — stays real, since the tree is what is under test here.
jest.mock('@tanstack/react-router', () => {
	const actual = jest.requireActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');

	return {
		...actual,
		HeadContent: () => null,
		Scripts: () => null,
		Outlet: () => <p>the open route</p>,
		Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
			<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
				{children}
			</a>
		),
		useRouter: () => ({ invalidate: () => Promise.resolve() }),
	};
});
// -------------------------

/**
 * The root route's options, narrowed to what this file reads.
 *
 * The router types these against its own deeply generic route shapes; restating
 * those here would be noise rather than safety, so each entry names only the
 * argument the app's own code passes it and the value it hands back.
 */
interface RootPage {
	head: () => { meta: Record<string, string>[]; links: { rel: string; href: string }[] };
	loader: (params: { context: { queryClient: QueryClient } }) => Promise<void>;
	component: ComponentType;
	errorComponent: ComponentType<{ error: Error; reset: () => void }>;
	notFoundComponent: ComponentType;
}

/** One of the tree's file routes, narrowed the same way. */
interface FilePage {
	options: { component: ComponentType };
	useParams: () => { runId: string };
}

const setupRouteTree = ({ runs = [buildRunListing()], repoRoot = '/repos/lightsout' }: { runs?: RunListing[]; repoRoot?: string } = {}) => {
	mockListRuns.mockResolvedValue(runs);
	mockGetRepoRoot.mockReturnValue(repoRoot);

	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createRouter({ routeTree, context: { queryClient } });
	const pages = (router as unknown as { routesById: Record<string, FilePage> }).routesById;
	const rootPage = pages.__root__.options as unknown as RootPage;

	return { pages, queryClient, repoRoot, rootPage, runs };
};

const setupRootPage = ({ runs = [buildRunListing()], repoRoot = '/repos/lightsout' }: { runs?: RunListing[]; repoRoot?: string } = {}) => {
	const { rootPage } = setupRouteTree({ runs, repoRoot });
	const Page = rootPage.component;

	renderWithQueryClient({
		ui: <Page />,
		seed: [
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot } },
			{ queryKey: [QueryKey.Runs], data: runs },
		],
	});
};

const setupCaughtError = ({ message = 'the run manifest is unreadable' }: { message?: string } = {}) => {
	const { rootPage } = setupRouteTree();
	const Page = rootPage.errorComponent;

	renderWithQueryClient({ ui: <Page error={new Error(message)} reset={() => {}} /> });
};

const setupMissingPage = () => {
	const { rootPage } = setupRouteTree();
	const Page = rootPage.notFoundComponent;

	renderWithQueryClient({ ui: <Page /> });
};

const setupStandardsPage = () => {
	const { pages } = setupRouteTree();
	const Page = pages['/standards'].options.component;

	renderWithQueryClient({ ui: <Page /> });
};

/**
 * The run detail route, rendered for one run id.
 *
 * `Route.useParams()` reads the match the live router is showing, so the id
 * comes from a spy on that one method rather than from a router driven to the
 * path — which is the routing library's behaviour, not this route's.
 */
const setupRunDetailPage = ({ runId = 'abcdef0123456789' }: { runId?: string } = {}) => {
	const { pages } = setupRouteTree();
	const route = pages['/runs/$runId'];
	jest.spyOn(route, 'useParams').mockReturnValue({ runId });
	const Page = route.options.component;

	renderWithQueryClient({ ui: <Page /> });
};

describe('routeTree', () => {
	test('hangs one route off the root for every route file the app has, and nothing else', () => {
		const { pages } = setupRouteTree();

		const ids = Object.keys(pages).sort();

		expect(ids).toStrictEqual(['/', '/runs/$runId', '/standards', '__root__']);
	});

	test('names the page, declares its encoding and viewport, and links the stylesheet the app is themed with', () => {
		const { rootPage } = setupRouteTree();

		const head = rootPage.head();

		expect(head.meta).toStrictEqual([{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'lightsout' }]);
		expect(head.links).toStrictEqual([{ rel: 'stylesheet', href: expect.any(String) }]);
	});

	test('warms both queries the sidebar reads before the first render', async () => {
		const { queryClient, repoRoot, rootPage, runs } = setupRouteTree({ repoRoot: '/repos/other-project' });

		await rootPage.loader({ context: { queryClient } });

		expect(queryClient.getQueryData([QueryKey.Runs])).toStrictEqual(runs);
		expect(queryClient.getQueryData([QueryKey.RepoRoot])).toStrictEqual({ repoRoot });
	});

	test('renders the page as an English HTML document', () => {
		setupRootPage();

		const page = document.querySelector('html[lang="en"]');

		expect(page).toBeInTheDocument();
	});

	test('puts the runs sidebar in that document', () => {
		setupRootPage({ runs: [buildRunListing({ title: 'raise coverage' })] });

		const sidebar = screen.getByRole('navigation', { name: 'Runs' });

		expect(sidebar.textContent).toContain('raise coverage');
	});

	test('puts whichever route is open beside that sidebar', () => {
		setupRootPage();

		const open = screen.getByText('the open route');

		expect(open).toBeInTheDocument();
	});

	test('shows what went wrong when a route throws', () => {
		setupCaughtError({ message: 'the run manifest is unreadable' });

		const message = screen.getByText('the run manifest is unreadable');

		expect(message).toBeInTheDocument();
	});

	test('offers a way back to the runs list for a path no route matches', () => {
		setupMissingPage();

		const back = screen.getByRole('link', { name: 'Back to runs' });

		expect(back).toHaveAttribute('href', '/');
	});

	test('the standards route stands in until the tab itself is built', () => {
		setupStandardsPage();

		const notice = screen.getByText(/arrives in a later phase/i);

		expect(notice).toBeInTheDocument();
	});

	test('the run detail route names the run whose id the path carries', () => {
		setupRunDetailPage({ runId: 'ffff0000ffff' });

		const notice = screen.getByText(/ffff0000ffff/);

		expect(notice).toBeInTheDocument();
	});
});
