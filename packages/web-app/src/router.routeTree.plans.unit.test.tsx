import { describe, expect, jest, test } from '@jest/globals';
import type { PlanWorkspaceListing, PlanWorkspaceView } from '@lightsout/engine';
import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { routeTree } from '#src/routeTree.gen.ts';
import { buildPlanWorkspaceListing } from '#tests/helpers/buildPlanWorkspaceListing.ts';
import { buildPlanWorkspaceView } from '#tests/helpers/buildPlanWorkspaceView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The route tree loads every route module and everything those modules render,
// and these two reach the engine's filesystem reader at the far end of that
// chain. Stubbing the reader keeps the whole graph off disk, and lets this file
// state its own workspaces rather than asserting against whatever this repo has
// planned today.
const mockListPlans = jest.fn<() => Promise<PlanWorkspaceListing[]>>();
const mockGetPlanWorkspace = jest.fn<() => Promise<PlanWorkspaceView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	// Everything else is the real thing: the frozen demo runs the landing page
	// reads are committed JSON rather than disk this test has to fake.
	...jest.requireActual<typeof import('#src/lightsout/index.ts')>('#src/lightsout/index.ts'),
	getReader: () => ({
		listPlanWorkspaces: () => mockListPlans(),
		getPlanWorkspace: () => mockGetPlanWorkspace(),
		getPlan: () => new Promise(() => {}),
	}),
}));
// -------------------------
// Only the pieces that need a live router around them are stood in for, so one
// route's component can be rendered on its own. Everything else — above all
// `createRouter` and the `createFileRoute` calls the tree is assembled from —
// stays real, since the tree is what is under test here.
jest.mock('@tanstack/react-router', () => {
	const actual = jest.requireActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');

	return {
		...actual,
		Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
			<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
				{children}
			</a>
		),
		useSearch: () => ({}),
		useNavigate: () => () => undefined,
	};
});
// -------------------------

/**
 * The two plan file routes, narrowed to what this file reads.
 *
 * The router types these against its own deeply generic route shapes; restating
 * those here would be noise rather than safety, so each entry names only the
 * argument the app's own code passes it and the value it hands back.
 */
interface FilePage {
	options: {
		component: ComponentType;
		notFoundComponent: ComponentType;
		loader: (input: { context: { queryClient: QueryClient }; params: { name: string } }) => Promise<void>;
		head: (input: { params: { name: string } }) => { meta: { title: string }[] };
		validateSearch: (search: Record<string, unknown>) => { stage?: string };
	};
	useParams: () => { name: string };
}

const name = 'add-search';

const setupRouteTree = ({ plans = [buildPlanWorkspaceListing({ name })], view = buildPlanWorkspaceView() } = {}) => {
	mockListPlans.mockResolvedValue(plans);
	mockGetPlanWorkspace.mockResolvedValue(view);

	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createRouter({ routeTree, context: { queryClient } });
	const pages = (router as unknown as { routesById: Record<string, FilePage> }).routesById;

	return { pages, plans, queryClient, view };
};

/** The plans list, over a set of workspaces this file states. */
const setupPlansPage = ({ plans = [buildPlanWorkspaceListing({ name })] }: { plans?: PlanWorkspaceListing[] } = {}) => {
	const { pages } = setupRouteTree({ plans });
	const Page = pages['/repo/plans/'].options.component;

	renderWithQueryClient({ ui: <Page />, seed: [{ queryKey: [QueryKey.PlanWorkspaces], data: plans }] });
};

/**
 * The detail page for one workspace.
 *
 * `Route.useParams()` reads the match a live router is showing, so the name
 * comes from a spy rather than from a router driven to the path — which is the
 * routing library's behaviour, not this route's.
 */
const setupPlanDetailPage = ({ view = buildPlanWorkspaceView() }: { view?: PlanWorkspaceView } = {}) => {
	const { pages } = setupRouteTree({ view });
	const route = pages['/repo/plans/$name'];
	jest.spyOn(route, 'useParams').mockReturnValue({ name });
	const Page = route.options.component;

	renderWithQueryClient({ ui: <Page />, seed: [{ queryKey: [QueryKey.PlanWorkspace, name], data: view }] });
};

/** The same route's answer for a name no workspace on disk carries. */
const setupMissingPlanPage = () => {
	const { pages } = setupRouteTree();
	const route = pages['/repo/plans/$name'];
	jest.spyOn(route, 'useParams').mockReturnValue({ name: 'never-planned' });
	const Page = route.options.notFoundComponent;

	renderWithQueryClient({ ui: <Page /> });
};

describe('routeTree plans', () => {
	test('the plans route names the tab before any query resolves', () => {
		const { pages } = setupRouteTree();

		expect(pages['/repo/plans/'].options.head({ params: { name } }).meta).toStrictEqual([{ title: 'Plans' }]);
	});

	test('the plans route warms the list the page suspends on', async () => {
		const { pages, plans, queryClient } = setupRouteTree();

		await pages['/repo/plans/'].options.loader({ context: { queryClient }, params: { name } });

		expect(queryClient.getQueryData([QueryKey.PlanWorkspaces])).toStrictEqual(plans);
	});

	test('the plans route keeps a stage the URL names, so a narrowed list is a link somebody can send', () => {
		const { pages } = setupRouteTree();

		expect(pages['/repo/plans/'].options.validateSearch({ stage: 'notes-only' })).toStrictEqual({ stage: 'notes-only' });
	});

	test('the plans route ignores a stage no plan can be at, rather than emptying the table', () => {
		const { pages } = setupRouteTree();

		expect(pages['/repo/plans/'].options.validateSearch({ stage: 'halfway' })).toStrictEqual({ stage: undefined });
	});

	test('the plans route is the page that lists every workspace this repo has', () => {
		setupPlansPage();

		expect(screen.getByRole('heading', { level: 1, name: 'Plans' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name })).toHaveAttribute('href', `/repo/plans/${name}`);
	});

	test('the plan detail route names the tab from the path alone', () => {
		const { pages } = setupRouteTree();

		expect(pages['/repo/plans/$name'].options.head({ params: { name } }).meta).toStrictEqual([{ title: 'add-search — plan' }]);
	});

	test('the plan detail route warms the workspace the page suspends on', async () => {
		const { pages, queryClient, view } = setupRouteTree();

		await pages['/repo/plans/$name'].options.loader({ context: { queryClient }, params: { name } });

		expect(queryClient.getQueryData([QueryKey.PlanWorkspace, name])).toStrictEqual(view);
	});

	test('the plan detail route is the page that shows one workspace whole', () => {
		setupPlanDetailPage();

		expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument();
	});

	test('the plan detail route says the name is the mistake when no workspace answers to it', () => {
		setupMissingPlanPage();

		expect(screen.getByRole('heading', { level: 1, name: 'No plan by that name.' })).toBeInTheDocument();
		expect(screen.getByText('never-planned')).toBeInTheDocument();
	});
});
