import { describe, expect, jest, test } from '@jest/globals';
import type { RunView } from '@lightsout/engine';
import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { routeTree } from '#src/routeTree.gen.ts';
import { buildRunView } from '#tests/helpers/buildRunView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The route tree loads every route module and everything those modules render,
// and the run detail route reaches the engine's filesystem reader at the far end
// of that chain. Stubbing the reader keeps the whole graph off disk.
const mockGetRun = jest.fn<(params: { runId: string }) => Promise<RunView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	// Everything else is the real thing: the frozen demo runs the proof section
	// reads are committed JSON rather than disk this test has to fake, and
	// stubbing them would make this suite prove a stub renders.
	...jest.requireActual<typeof import('#src/lightsout/index.ts')>('#src/lightsout/index.ts'),
	getReader: () => ({ getRun: (params: { runId: string }) => mockGetRun(params) }),
}));
// -------------------------
// Whether a repo was found is answered by walking the real filesystem, so the
// page would otherwise report whatever directory Jest happened to start in.
jest.mock('#src/common/utils/findRepoRoot.ts', () => ({
	findRepoRoot: () => '/repos/lightsout',
}));
// -------------------------
// Only the piece that needs a live router around it is stood in for, so this one
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
	};
});
// -------------------------

/**
 * The run detail file route, narrowed to what this file reads.
 *
 * The router types these against its own deeply generic route shapes; restating
 * those here would be noise rather than safety, so each entry names only the
 * argument the app's own code passes it and the value it hands back.
 */
interface FilePage {
	options: {
		component: ComponentType;
		notFoundComponent: ComponentType;
		loader: (input: { context: { queryClient: QueryClient }; params: { runId: string } }) => Promise<void>;
	};
	useParams: () => { runId: string };
}

const repoRoot = '/repos/lightsout';

const setupRunDetailRoute = () => {
	const runView = buildRunView();

	mockGetRun.mockResolvedValue(runView);

	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createRouter({ routeTree, context: { queryClient } });
	const route = (router as unknown as { routesById: Record<string, FilePage> }).routesById['/repo/runs_/$runId'];

	return { queryClient, route, runView };
};

/**
 * The run detail route, rendered for one run id.
 *
 * `Route.useParams()` reads the match the live router is showing, so the id
 * comes from a spy on that one method rather than from a router driven to the
 * path — which is the routing library's behaviour, not this route's.
 */
const setupRunDetailPage = ({ runId = 'abcdef0123456789' }: { runId?: string } = {}) => {
	const { route, runView } = setupRunDetailRoute();
	jest.spyOn(route, 'useParams').mockReturnValue({ runId });
	const Page = route.options.component;

	renderWithQueryClient({
		ui: <Page />,
		seed: [
			{ queryKey: [QueryKey.Run, runId], data: runView },
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot } },
		],
	});
};

/** The same route's answer for an id nothing on disk carries — what the server function's `notFound()` reaches. */
const setupMissingRunPage = ({ runId = 'no-such-run' }: { runId?: string } = {}) => {
	const { route } = setupRunDetailRoute();
	jest.spyOn(route, 'useParams').mockReturnValue({ runId });
	const Page = route.options.notFoundComponent;

	renderWithQueryClient({ ui: <Page /> });
};

// The tree this file drives lives in `routeTree.gen.ts`, which TanStack Router
// writes and the repo lists as generated output — so it is not a subject a test
// may be named after. `router.tsx` is the tree's only consumer, which makes this
// a scenario suite on the router: what the run detail route serves, as opposed
// to the shell and the rest of the local zone its sibling suite carries.
describe('routeTree', () => {
	test('the run detail route renders the evidence of the run whose id the path carries', () => {
		setupRunDetailPage({ runId: 'ffff0000ffff' });

		const heading = screen.getByRole('heading', { level: 1, name: 'add search' });

		expect(heading).toBeInTheDocument();
	});

	test('the run detail route says which id nothing on disk answers to', () => {
		setupMissingRunPage({ runId: 'no-such-run' });

		const notice = screen.getByText(/no-such-run/);

		expect(notice).toBeInTheDocument();
	});

	test('the run detail route warms its own run before the page renders', async () => {
		const { queryClient, route, runView } = setupRunDetailRoute();

		await route.options.loader({ context: { queryClient }, params: { runId: 'abcdef0123456789' } });

		expect(queryClient.getQueryData([QueryKey.Run, 'abcdef0123456789'])).toStrictEqual(runView);
	});
});
