import { describe, expect, jest, test } from '@jest/globals';
import type { RunListing } from '@lightsout/engine';
import { QueryClient } from '@tanstack/react-query';
import type { AnyRouter } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { DefaultCatchBoundary } from '#src/common/components/boundaries/DefaultCatchBoundary.tsx';
import { NotFound } from '#src/common/components/boundaries/NotFound.tsx';
import { getRouter } from '#src/router.tsx';

// Mocked Imports
// -------------------------
// Building a router loads the generated route tree, which loads every route
// module and everything those render — and the runs route reaches the engine's
// filesystem reader at the far end of that chain. Stubbing the reader keeps the
// graph off disk, leaving this file asserting on what `getRouter` itself
// decides: where the app can navigate, and what it renders when a route throws
// or matches nothing. Nothing here is called while a router is built.
const mockListRuns = jest.fn<() => Promise<RunListing[]>>();

jest.mock('#src/lightsout/index.ts', () => ({
	// Everything else is the real thing: the frozen demo runs Home reads are
	// committed JSON rather than disk this test has to fake.
	...jest.requireActual<typeof import('#src/lightsout/index.ts')>('#src/lightsout/index.ts'),
	getReader: () => ({ listRuns: () => mockListRuns() }),
}));
// -------------------------
// The query integration reaches the router's server-side header helpers, which
// require an ESM-only cookie package that Jest's CommonJS loader cannot parse.
// All it does is subscribe the query client to the router it is handed and
// return that same router, so a pass-through stands in for it — and the spy is
// what lets a test prove the two halves were given the *same* client.
const mockRouterWithQueryClient = jest.fn<(router: AnyRouter, queryClient: QueryClient) => AnyRouter>();

jest.mock('@tanstack/react-router-with-query', () => ({
	routerWithQueryClient: (router: AnyRouter, queryClient: QueryClient) => mockRouterWithQueryClient(router, queryClient),
}));
// -------------------------

const setupRouter = () => {
	mockListRuns.mockResolvedValue([]);
	mockRouterWithQueryClient.mockImplementation((router) => router);
};

/**
 * The fallback the router renders for an unmatched path, ready to call.
 *
 * The router types that option against its own `NotFoundRouteProps`, which
 * carries a route id and a flag; this app's fallback takes no props at all, so
 * restating that shape here would be noise rather than safety.
 */
const setupNotFoundComponent = () => {
	setupRouter();

	const renderNotFound = getRouter().options.defaultNotFoundComponent as unknown as () => ReactElement;

	return { renderNotFound };
};

describe('getRouter', () => {
	test('serves every route the app has a file for, and nothing else', () => {
		setupRouter();

		const router = getRouter();

		expect(Object.keys(router.routesById).sort()).toStrictEqual([
			'/',
			'/commands/',
			'/commands/$command',
			'/docs/$doc',
			'/repo/',
			'/repo/config',
			'/repo/friction',
			'/repo/plans/',
			'/repo/plans/$name',
			'/repo/runs',
			'/repo/runs_/$runId',
			'/repo/standards',
			'/standards/',
			'/standards/$pack/',
			'/standards/$pack/$rule',
			'__root__',
		]);
	});

	test("hands the routes' loaders a query client to prefetch through", () => {
		setupRouter();

		const router = getRouter();

		expect(router.options.context.queryClient).toBeInstanceOf(QueryClient);
	});

	test("gives every router its own query client, so one request never reads another request's cache", () => {
		setupRouter();

		const clients = [getRouter(), getRouter()].map((router) => router.options.context.queryClient);

		expect(clients[0]).not.toBe(clients[1]);
	});

	test('caches through the same query client the routes are handed', () => {
		setupRouter();

		const router = getRouter();

		expect(mockRouterWithQueryClient).toHaveBeenCalledWith(router, router.options.context.queryClient);
	});

	test('shows the shared catch boundary when a route throws', () => {
		setupRouter();

		const router = getRouter();

		expect(router.options.defaultErrorComponent).toBe(DefaultCatchBoundary);
	});

	test('shows the not-found panel when a route matches nothing', () => {
		const { renderNotFound } = setupNotFoundComponent();

		const notFound = renderNotFound();

		expect(notFound.type).toBe(NotFound);
	});
});
