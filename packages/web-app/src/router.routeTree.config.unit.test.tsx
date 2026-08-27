import { describe, expect, jest, test } from '@jest/globals';
import { ConfigNotFoundError, type ConfigView } from '@lightsout/engine';
import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { routeTree } from '#src/routeTree.gen.ts';
import { buildConfigView } from '#tests/helpers/buildConfigView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The route tree loads every route module and everything those modules render,
// and the config route reaches the engine's filesystem reader at the far end of
// that chain. Stubbing the reader keeps the whole graph off disk, and lets this
// file state the config it is rendering rather than asserting against whatever
// this repo's own lightsout.config.json happens to say today.
const mockGetConfig = jest.fn<() => Promise<ConfigView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	// Everything else is the real thing: the frozen demo runs Home reads are
	// committed JSON rather than disk this test has to fake, and stubbing them
	// would make this suite prove a stub renders.
	...jest.requireActual<typeof import('#src/lightsout/index.ts')>('#src/lightsout/index.ts'),
	getReader: () => ({ getConfig: () => mockGetConfig() }),
}));
// -------------------------
// Only the piece that needs a live router around it is stood in for, so this one
// route's component can be rendered on its own. Everything else — above all
// `createRouter`, the `createFileRoute` calls the tree is assembled from, and
// the `notFound` the server function throws — stays real, since the tree is what
// is under test here.
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
 * The config file route, narrowed to what this file reads.
 *
 * The router types these against its own deeply generic route shapes; restating
 * those here would be noise rather than safety, so each entry names only the
 * argument the app's own code passes it and the value it hands back.
 */
interface FilePage {
	options: {
		component: ComponentType;
		loader: (input: { context: { queryClient: QueryClient } }) => Promise<void>;
		head: () => { meta: { title: string }[] };
	};
}

interface SetupParams {
	/** What the reader answers the route with, when it answers at all. */
	view?: ConfigView;
	/**
	 * What the reader throws instead — a config file that is not there, or one
	 * that is there and will not parse. The two travel differently on purpose.
	 */
	rejection?: Error;
}

const setupConfigRoute = ({ view = buildConfigView(), rejection }: SetupParams = {}) => {
	if (rejection) {
		mockGetConfig.mockRejectedValue(rejection);
	} else {
		mockGetConfig.mockResolvedValue(view);
	}

	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createRouter({ routeTree, context: { queryClient } });
	const route = (router as unknown as { routesById: Record<string, FilePage> }).routesById['/repo/config'];

	return { queryClient, route, view };
};

/**
 * The config route's page, over a cache already holding the view.
 *
 * Seeding the key the page suspends on is what keeps the render synchronous —
 * the loader's own trip to the reader is a separate question, asked above.
 */
const setupConfigPage = ({ view = buildConfigView() }: { view?: ConfigView } = {}) => {
	const { route } = setupConfigRoute({ view });
	const Page = route.options.component;

	renderWithQueryClient({ ui: <Page />, seed: [{ queryKey: [QueryKey.Config], data: view }] });

	return { view };
};

// The tree this file drives lives in `routeTree.gen.ts`, which TanStack Router
// writes and the repo lists as generated output — so it is not a subject a test
// may be named after. `router.tsx` is the tree's only consumer, which makes this
// a scenario suite on the router: what the config route serves, as opposed to
// the shell and the rest of the local zone its sibling suites carry.
describe('routeTree', () => {
	test('the config route names the tab before any query resolves', () => {
		const { route } = setupConfigRoute();

		const head = route.options.head();

		expect(head.meta).toStrictEqual([{ title: 'Config' }]);
	});

	test('the config route warms the resolved config, so the page needs no second round trip', async () => {
		const { queryClient, route, view } = setupConfigRoute();

		await route.options.loader({ context: { queryClient } });

		expect(queryClient.getQueryData([QueryKey.Config])).toStrictEqual(view);
	});

	test('the config route answers a repo with no config file with the router’s own not-found', async () => {
		const { queryClient, route } = setupConfigRoute({
			rejection: new ConfigNotFoundError({ configPath: '/repos/lightsout/lightsout.config.json' }),
		});

		const loading = route.options.loader({ context: { queryClient } });

		await expect(loading).rejects.toStrictEqual({ isNotFound: true });
	});

	test('the config route lets a config that will not parse travel with the message that says which key is wrong', async () => {
		const { queryClient, route } = setupConfigRoute({
			rejection: new Error('gates.check: expected string, received number'),
		});

		const loading = route.options.loader({ context: { queryClient } });

		await expect(loading).rejects.toThrow('gates.check: expected string, received number');
	});

	test('the config route serves the page that says what this repo told lightsout', () => {
		setupConfigPage();

		const heading = screen.getByRole('heading', { level: 1, name: 'Config' });

		expect(heading).toBeInTheDocument();
	});

	test('the config route serves that page over the config it warmed, not over a second read', () => {
		setupConfigPage({ view: buildConfigView({ overrides: { path: '/repos/other-project/lightsout.config.json' } }) });

		const path = screen.getByText('/repos/other-project/lightsout.config.json');

		expect(path).toBeInTheDocument();
	});
});
