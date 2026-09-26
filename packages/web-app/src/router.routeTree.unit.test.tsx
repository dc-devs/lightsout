import { afterEach, describe, expect, jest, test } from '@jest/globals';
import type { RunListing, StandardsView } from '@lightsout/engine';
import { QueryClient } from '@tanstack/react-query';
import { createRouter, isNotFound } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { Theme } from '#src/common/constants/Theme.ts';
import { routeTree } from '#src/routeTree.gen.ts';
import appCssHref from '#src/styles/app.css?url';
import { ThemeProvider } from '#src/theme/ThemeProvider.tsx';
import { buildConfigView } from '#tests/helpers/buildConfigView.ts';
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

jest.mock('#src/lightsout/getReader.ts', () => ({
	getReader: () => ({
		listRuns: () => mockListRuns(),
		getStandards: () => mockGetStandards(),
		getFriction: () => Promise.resolve([]),
		listPlanWorkspaces: () => Promise.resolve([]),
	}),
}));
// -------------------------
// Which repo is open is answered by walking the real filesystem, so the app
// frame would otherwise report whatever directory Jest happened to start in.
// Only the walk is stood in for: whether the site is public is the real
// `isPublicDeployment`, read from the variable each test sets.
const mockRequireLocalRepoRoot = jest.fn<() => string>();

jest.mock('#src/common/utils/requireLocalRepoRoot.ts', () => ({
	requireLocalRepoRoot: () => mockRequireLocalRepoRoot(),
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
	/** Absent: the root asks nothing of any repo, so a public page never waits on one. */
	loader?: (params: { context: { queryClient: QueryClient } }) => Promise<void>;
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
		head: () => { meta: { title: string }[] };
		beforeLoad: (input: { context: { queryClient: QueryClient } }) => Promise<void>;
		loader: (input: { context: { queryClient: QueryClient } }) => Promise<void>;
	};
}

interface SetupParams {
	runs?: RunListing[];
	/** The repository root the app is rendered against. */
	repoRoot?: string;
}

const setupRouteTree = ({ runs = [buildRunListing()], repoRoot = '/repos/lightsout' }: SetupParams = {}) => {
	const standards = buildStandardsView();

	mockListRuns.mockResolvedValue(runs);
	mockGetStandards.mockResolvedValue(standards);
	mockRequireLocalRepoRoot.mockReturnValue(repoRoot);

	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createRouter({ routeTree, context: { queryClient } });
	const pages = (router as unknown as { routesById: Record<string, FilePage> }).routesById;
	const rootPage = pages.__root__.options as unknown as RootPage;

	return { pages, queryClient, repoRoot, rootPage, runs, standards };
};

/** The app frame's gate, on a local dev server or on the public site. */
const setupAppGate = ({ publicSite = false }: { publicSite?: boolean } = {}) => {
	const { pages, queryClient, repoRoot } = setupRouteTree({ repoRoot: '/repos/other-project' });

	if (publicSite) {
		process.env.LIGHTSOUT_PUBLIC = '1';
	}

	return { beforeLoad: pages['/app'].options.beforeLoad, queryClient, repoRoot };
};

/** What a gate threw, so a test can assert on a refusal that is not an `Error`. */
const catchRefusal = async ({ attempt }: { attempt: () => Promise<void> }): Promise<unknown> => {
	try {
		await attempt();
	} catch (error) {
		return error;
	}

	throw new Error('the gate let the load through where it should have refused');
};

/** Any route's loader, with the client it fills and the data the reader will answer it with. */
const setupLoader = ({ id }: { id: string }) => {
	const { pages, queryClient, runs, standards } = setupRouteTree();

	return { loader: pages[id].options.loader, queryClient, runs, standards };
};

const setupRootPage = (params: SetupParams = {}) => {
	const { repoRoot, rootPage, runs } = setupRouteTree(params);
	const Page = rootPage.component;

	renderWithQueryClient({
		ui: <Page />,
		seed: [
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot } },
			{ queryKey: [QueryKey.Runs], data: runs },
		],
	});
};

/** One of the two frames — `/_site` or `/app` — with a route open inside it. */
const setupFrame = ({ id, ...params }: SetupParams & { id: string }) => {
	const { pages, repoRoot, runs } = setupRouteTree(params);
	const Frame = pages[id].options.component;

	renderWithQueryClient({
		// The frames carry the theme control, which the root route's provider wraps
		// in the running app; rendering one on its own has to supply it.
		ui: (
			<ThemeProvider defaultTheme={Theme.Dark}>
				<Frame />
			</ThemeProvider>
		),
		seed: [
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot } },
			{ queryKey: [QueryKey.Runs], data: runs },
		],
	});
};

/** The landing page, with the site frame around it — every link a public visitor starts from. */
const setupLandingInFrame = () => {
	const { pages } = setupRouteTree();
	const Frame = pages['/_site'].options.component;
	const Landing = pages['/_site/'].options.component;

	renderWithQueryClient({
		ui: (
			<ThemeProvider defaultTheme={Theme.Dark}>
				<Frame />
				<Landing />
			</ThemeProvider>
		),
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
	const Page = pages['/app/standards'].options.component;

	renderWithQueryClient({ ui: <Page />, seed: [{ queryKey: [QueryKey.Standards], data: standards }] });
};

const setupRepoIndexPage = (params: SetupParams = {}) => {
	const { pages, repoRoot, runs, standards } = setupRouteTree(params);
	const Page = pages['/app/'].options.component;

	renderWithQueryClient({
		ui: <Page />,
		seed: [
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot } },
			{ queryKey: [QueryKey.Runs], data: runs },
			{ queryKey: [QueryKey.Standards], data: standards },
			{ queryKey: [QueryKey.Friction], data: [] },
			{ queryKey: [QueryKey.Config], data: buildConfigView() },
		],
	});
};

const setupRunsPage = ({ runs = [buildRunListing({ title: 'raise coverage' })], ...rest }: SetupParams = {}) => {
	const { pages, repoRoot } = setupRouteTree({ runs, ...rest });
	const Page = pages['/app/runs'].options.component;

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
afterEach(() => {
	delete process.env.LIGHTSOUT_PUBLIC;
	jest.clearAllMocks();
});

describe('routeTree', () => {
	// The `_` in `/app/runs_/$runId` is the router's own mark for a route that
	// does not nest inside its path's parent; the address a reader sees is still
	// /app/runs/$runId.
	//
	// `/_site` and `/app` are the two frames. `/_site` carries no address of its
	// own — the pages under it are served at `/`, `/standards-packs` and the rest,
	// exactly where they always were — and which frame a page wears is settled by
	// which of the two it sits under.
	test('hangs one route off the root for every route file the app has, and nothing else', () => {
		const { pages } = setupRouteTree();

		const ids = Object.keys(pages).sort();

		expect(ids).toStrictEqual([
			'/_site',
			'/_site/',
			'/_site/commands/',
			'/_site/commands/$command',
			'/_site/docs/$doc',
			'/_site/standards-packs/',
			'/_site/standards-packs/$ruleSet/',
			'/_site/standards-packs/$ruleSet/$rule',
			'/app',
			'/app/',
			'/app/config',
			'/app/friction',
			'/app/plans/',
			'/app/plans/$name',
			'/app/runs',
			'/app/runs_/$runId',
			'/app/standards',
			'__root__',
		]);
	});

	test('names the page, declares its encoding and viewport, and links the stylesheet the app is themed with', () => {
		const { rootPage } = setupRouteTree();

		const head = rootPage.head();

		expect(head.meta).toStrictEqual([{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'lightsout' }]);
		expect(head.links).toStrictEqual([{ rel: 'stylesheet', href: appCssHref }]);
	});

	test('asks nothing of any repo at the root, so the public pages never do', () => {
		const { rootPage } = setupRouteTree();

		expect(rootPage.loader).toBeUndefined();
	});

	test('fetches which repo is open before any app page loads, leaving run state to the pages that show it', async () => {
		const { beforeLoad, queryClient, repoRoot } = setupAppGate();

		await beforeLoad({ context: { queryClient } });

		expect({ repoRoot: queryClient.getQueryData([QueryKey.RepoRoot]), runs: queryClient.getQueryData([QueryKey.Runs]) }).toStrictEqual({
			repoRoot: { repoRoot },
			runs: undefined,
		});
	});

	test('answers not-found for the whole app on the public site, before any page under it loads', async () => {
		const { beforeLoad, queryClient } = setupAppGate({ publicSite: true });

		const refusal = await catchRefusal({ attempt: () => beforeLoad({ context: { queryClient } }) });

		expect(isNotFound(refusal)).toBe(true);
	});

	test('asks the server nothing on the public site, so not even the repo root is fetched', async () => {
		const { beforeLoad, queryClient } = setupAppGate({ publicSite: true });

		await catchRefusal({ attempt: () => beforeLoad({ context: { queryClient } }) });

		expect(mockRequireLocalRepoRoot).not.toHaveBeenCalled();
	});

	test('renders the page as an English HTML document', () => {
		setupRootPage();

		const page = document.querySelector('html[lang="en"]');

		expect(page).toBeInTheDocument();
	});

	test('sends that document light, so a first-time reader never sees the dark theme flash past', () => {
		setupRootPage();

		const page = document.querySelector('html[lang="en"]');

		expect(page?.className.split(' ')).toContain('light');
	});

	test('puts whichever route is open inside that document', () => {
		setupRootPage();

		const open = screen.getByText('the open route');

		expect(open).toBeInTheDocument();
	});

	test('gives the app frame the local zone when a repo was found', () => {
		setupFrame({ id: '/app', repoRoot: '/repos/other-project' });

		const zone = screen.getByRole('navigation', { name: 'Your repo' });

		expect(zone.textContent).toContain('Runs');
	});

	test('leaves the local zone out of the site frame, so the landing page is not wearing a sidebar', () => {
		setupFrame({ id: '/_site', repoRoot: '/repos/other-project' });

		const zone = screen.queryByRole('navigation', { name: 'Your repo' });

		expect(zone).not.toBeInTheDocument();
	});

	test('offers the public pages no way into the app, even with a repo found, since they never read one', () => {
		setupFrame({ id: '/_site', repoRoot: '/repos/other-project' });

		const app = screen.queryByRole('link', { name: 'App' });

		expect(app).not.toBeInTheDocument();
	});

	test('links nowhere into the app from the landing page or the frame around it', () => {
		setupLandingInFrame();

		const hrefs = screen.queryAllByRole('link').map((link) => link.getAttribute('href') ?? '');

		// The site's own links are counted too, so an empty render cannot pass as a page with no way into the app.
		expect({ sitePages: hrefs.includes('/commands'), intoApp: hrefs.filter((href) => href.startsWith('/app')) }).toStrictEqual({
			sitePages: true,
			intoApp: [],
		});
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
		const landing = pages['/_site/'].options as unknown as { head: () => { meta: { title?: string }[] }; loader?: unknown };

		expect(landing.head().meta[0].title).toBe('lightsout — Stop the slop.');
		expect(landing.loader).toBeUndefined();
	});

	test('the repo route warms the run list it counts', async () => {
		const { loader, queryClient, runs } = setupLoader({ id: '/app/' });

		await loader({ context: { queryClient } });

		expect(queryClient.getQueryData([QueryKey.Runs])).toStrictEqual(runs);
	});

	test('the repo route titles the tab after what the page answers, not after the zone', () => {
		const { pages } = setupRouteTree();

		const head = pages['/app/'].options.head();

		expect(head.meta).toStrictEqual([{ title: 'Health' }]);
	});

	test('the repo route is the local zone’s health page', () => {
		setupRepoIndexPage();

		const heading = screen.getByRole('heading', { level: 1, name: 'Health' });

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
		const { loader, queryClient, runs } = setupLoader({ id: '/app/runs' });

		await loader({ context: { queryClient } });

		expect(queryClient.getQueryData([QueryKey.Runs])).toStrictEqual(runs);
	});

	test('the standards route renders what the repo enforces and what is open under it', () => {
		setupStandardsPage();

		const heading = screen.getByRole('heading', { level: 1, name: 'Standards' });

		expect(heading).toBeInTheDocument();
	});

	test('the standards route warms its own view before the page renders', async () => {
		const { loader, queryClient, standards } = setupLoader({ id: '/app/standards' });

		await loader({ context: { queryClient } });

		expect(queryClient.getQueryData([QueryKey.Standards])).toStrictEqual(standards);
	});
});
