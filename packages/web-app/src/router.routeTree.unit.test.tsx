import { describe, expect, jest, test } from '@jest/globals';
import type { RunListing, StandardsView } from '@lightsout/engine';
import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { routeTree } from '#src/routeTree.gen.ts';
import appCssHref from '#src/styles/app.css?url';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';
import { buildStandardsView } from '#tests/helpers/buildStandardsView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The route tree loads every route module and everything those modules render,
// and the runs route reaches the engine's filesystem reader at the far end of
// that chain. Stubbing the reader keeps the whole graph off disk.
const mockListRuns = jest.fn<() => Promise<RunListing[]>>();
const mockGetStandards = jest.fn<() => Promise<StandardsView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	// Everything else is the real thing: the frozen demo runs the proof section
	// reads are committed JSON rather than disk this test has to fake, and
	// stubbing them would make this suite prove a stub renders.
	...jest.requireActual<typeof import('#src/lightsout/index.ts')>('#src/lightsout/index.ts'),
	getReader: () => ({
		listRuns: () => mockListRuns(),
		getStandards: () => mockGetStandards(),
	}),
}));
// -------------------------
// Whether a repo was found is answered by walking the real filesystem, so the
// root route's loader would otherwise report whatever directory Jest happened
// to start in.
const mockFindRepoRoot = jest.fn<() => string | undefined>();

jest.mock('#src/common/utils/findRepoRoot.ts', () => ({
	findRepoRoot: () => mockFindRepoRoot(),
}));
// -------------------------
// The runs page holds its filters in the URL, and outside a live router there is
// nothing to read them from or navigate with.
const mockNavigate = jest.fn<(options: { search: Record<string, unknown>; replace: boolean }) => void>();
const mockSearch: Record<string, unknown> = {};
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
		useSearch: () => mockSearch,
		useNavigate: () => mockNavigate,
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

/**
 * One of the tree's file routes, narrowed the same way.
 *
 * Every field is stated as present because each is read only on the route that
 * declares it, and no test reaches past that — the run detail route and the
 * standards routes have suites of their own.
 */
interface FilePage {
	options: {
		component: ComponentType;
		notFoundComponent: ComponentType;
		loader: (input: { context: { queryClient: QueryClient } }) => Promise<void>;
	};
}

const setupRouteTree = ({ runs = [buildRunListing()], repoRoot = '/repos/lightsout' }: { runs?: RunListing[]; repoRoot?: string | undefined } = {}) => {
	const standards = buildStandardsView();

	mockListRuns.mockResolvedValue(runs);
	mockGetStandards.mockResolvedValue(standards);
	mockFindRepoRoot.mockReturnValue(repoRoot);

	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createRouter({ routeTree, context: { queryClient } });
	const pages = (router as unknown as { routesById: Record<string, FilePage> }).routesById;
	const rootPage = pages.__root__.options as unknown as RootPage;

	return { pages, queryClient, repoRoot, rootPage, runs, standards };
};

/** Any route's loader, with the client it fills and the data the reader will answer it with. */
const setupLoader = ({ id }: { id: string }) => {
	const { pages, queryClient, runs, standards } = setupRouteTree();

	return { loader: pages[id].options.loader, queryClient, runs, standards };
};

const setupRootPage = ({ runs = [buildRunListing()], repoRoot = '/repos/lightsout' }: { runs?: RunListing[]; repoRoot?: string | undefined } = {}) => {
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
	const { pages, standards } = setupRouteTree();
	const Page = pages['/repo/standards'].options.component;

	renderWithQueryClient({ ui: <Page />, seed: [{ queryKey: [QueryKey.Standards], data: standards }] });
};

const setupRepoIndexPage = ({ runs = [buildRunListing()], repoRoot = '/repos/lightsout' }: { runs?: RunListing[]; repoRoot?: string } = {}) => {
	const { pages } = setupRouteTree({ runs, repoRoot });
	const Page = pages['/repo/'].options.component;

	renderWithQueryClient({
		ui: <Page />,
		seed: [
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot } },
			{ queryKey: [QueryKey.Runs], data: runs },
		],
	});
};

const setupRunsPage = ({
	runs = [buildRunListing({ title: 'raise coverage' })],
	repoRoot = '/repos/lightsout',
}: {
	runs?: RunListing[];
	repoRoot?: string;
} = {}) => {
	const { pages } = setupRouteTree({ runs, repoRoot });
	const Page = pages['/repo/runs'].options.component;

	renderWithQueryClient({
		ui: <Page />,
		seed: [
			{ queryKey: [QueryKey.Runs], data: runs },
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot } },
		],
	});
};

// The tree this file drives lives in `routeTree.gen.ts`, which TanStack Router
// writes and the repo lists as generated output — so it is not a subject a test
// may be named after. `router.tsx` is the tree's only consumer, which makes this
// a scenario suite on the router: what it serves, as opposed to how it is wired.
//
// The sell zone's three standards routes and the run detail route are concerns
// of their own and have their own suites beside this one; this file carries the
// shell and the rest of the local zone.
describe('routeTree', () => {
	// The `_` in `/repo/runs_/$runId` is the router's own mark for a route that
	// does not nest inside its path's parent; the address a reader sees is still
	// /repo/runs/$runId.
	test('hangs one route off the root for every route file the app has, and nothing else', () => {
		const { pages } = setupRouteTree();

		const ids = Object.keys(pages).sort();

		expect(ids).toStrictEqual([
			'/',
			'/repo/',
			'/repo/runs',
			'/repo/runs_/$runId',
			'/repo/standards',
			'/standards/',
			'/standards/$pack/',
			'/standards/$pack/$rule',
			'__root__',
		]);
	});

	test('names the page, declares its encoding and viewport, and links the stylesheet the app is themed with', () => {
		const { rootPage } = setupRouteTree();

		const head = rootPage.head();

		expect(head.meta).toStrictEqual([{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'lightsout' }]);
		expect(head.links).toStrictEqual([{ rel: 'stylesheet', href: appCssHref }]);
	});

	test('warms only the question the shell itself asks, leaving run state to the pages that show it', async () => {
		const { queryClient, repoRoot, rootPage } = setupRouteTree({ repoRoot: '/repos/other-project' });

		await rootPage.loader({ context: { queryClient } });

		expect(queryClient.getQueryData([QueryKey.RepoRoot])).toStrictEqual({ repoRoot });
		expect(queryClient.getQueryData([QueryKey.Runs])).toBeUndefined();
	});

	test('renders the page as an English HTML document', () => {
		setupRootPage();

		const page = document.querySelector('html[lang="en"]');

		expect(page).toBeInTheDocument();
	});

	test('sends that document dark, so a first-time reader never sees the light theme flash past', () => {
		setupRootPage();

		const page = document.querySelector('html[lang="en"]');

		expect(page?.className).toContain('dark');
	});

	test('puts the local zone in that document when a repo was found', () => {
		setupRootPage({ repoRoot: '/repos/other-project' });

		const zone = screen.getByRole('navigation', { name: 'Your repo' });

		expect(zone.textContent).toContain('Runs');
	});

	test('puts whichever route is open beside that navigation', () => {
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

	test('the landing route is the page that sells the product, and warms nothing', () => {
		const { pages } = setupRouteTree();

		// Narrowed the way the root's own options are above: the router types these
		// against its deeply generic route shapes, and this route declares a head
		// and deliberately no loader.
		const landing = pages['/'].options as unknown as { head: () => { meta: { title?: string }[] }; loader?: unknown };

		expect(landing.head().meta[0].title).toBe('lightsout — Stop the slop.');
		expect(landing.loader).toBeUndefined();
	});

	test('the repo route warms the run list it counts', async () => {
		const { loader, queryClient, runs } = setupLoader({ id: '/repo/' });

		await loader({ context: { queryClient } });

		expect(queryClient.getQueryData([QueryKey.Runs])).toStrictEqual(runs);
	});

	test('the repo route is the local zone’s landing page', () => {
		setupRepoIndexPage();

		const heading = screen.getByRole('heading', { level: 1, name: 'Your repo' });

		expect(heading).toBeInTheDocument();
	});

	test('the runs route gives that list a page of its own', () => {
		setupRunsPage();

		const heading = screen.getByRole('heading', { level: 1, name: 'Runs' });

		expect(heading).toBeInTheDocument();
	});

	test('the runs route lists what the repo has', () => {
		setupRunsPage({ runs: [buildRunListing({ title: 'raise coverage' })] });

		const row = screen.getByRole('link', { name: /raise coverage/ });

		expect(row).toBeInTheDocument();
	});

	test('the runs route warms its own list before the page renders', async () => {
		const { loader, queryClient, runs } = setupLoader({ id: '/repo/runs' });

		await loader({ context: { queryClient } });

		expect(queryClient.getQueryData([QueryKey.Runs])).toStrictEqual(runs);
	});

	test('the standards route renders what the repo enforces and what is open under it', () => {
		setupStandardsPage();

		const heading = screen.getByRole('heading', { level: 1, name: 'Standards' });

		expect(heading).toBeInTheDocument();
	});

	test('the standards route warms its own view before the page renders', async () => {
		const { loader, queryClient, standards } = setupLoader({ id: '/repo/standards' });

		await loader({ context: { queryClient } });

		expect(queryClient.getQueryData([QueryKey.Standards])).toStrictEqual(standards);
	});
});
