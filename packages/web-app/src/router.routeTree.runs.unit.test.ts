import { describe, expect, test } from '@jest/globals';
import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { routeTree } from '#src/routeTree.gen.ts';

/**
 * The runs route's options, narrowed to what this file reads.
 *
 * The router types these against its own deeply generic route shapes; restating
 * those here would be noise rather than safety, so the one entry names only the
 * argument the app's own code passes it and the value it hands back.
 */
interface FilePage {
	options: {
		head: () => { meta: { title: string }[] };
		validateSearch: (search: Record<string, unknown>) => Record<string, unknown>;
	};
}

const setupRunsRoute = () => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createRouter({ routeTree, context: { queryClient } });
	const pages = (router as unknown as { routesById: Record<string, FilePage> }).routesById;

	return { head: pages['/repo/runs'].options.head, validateSearch: pages['/repo/runs'].options.validateSearch };
};

// The tree this file drives lives in `routeTree.gen.ts`, which TanStack Router
// writes and the repo lists as generated output — so it is not a subject a test
// may be named after. `router.tsx` is the tree's only consumer, which makes this
// a scenario suite on the router: what the runs route accepts from a URL, as
// opposed to the shell and the local zone its sibling suite carries.
describe('routeTree', () => {
	test('the runs route names the browser tab after the page it opens', () => {
		const { head } = setupRunsRoute();

		const meta = head().meta;

		expect(meta).toStrictEqual([{ title: 'Runs' }]);
	});

	test('the runs route keeps every query value its vocabularies know', () => {
		const { validateSearch } = setupRunsRoute();

		const search = validateSearch({ commands: ['refactor'], statuses: ['failed'], text: 'coverage', sortKey: 'cost', sortDirection: 'asc' });

		expect(search).toStrictEqual({ commands: ['refactor'], statuses: ['failed'], text: 'coverage', sortKey: 'cost', sortDirection: 'asc' });
	});

	test('the runs route reads a lone query value as the one-value set it means', () => {
		const { validateSearch } = setupRunsRoute();

		const search = validateSearch({ commands: 'implement · phased' });

		expect(search).toStrictEqual({ commands: ['implement · phased'], statuses: undefined, text: undefined, sortKey: undefined, sortDirection: undefined });
	});

	test('the runs route ignores a filter value outside those vocabularies, rather than narrowing to no run at all', () => {
		const { validateSearch } = setupRunsRoute();

		const search = validateSearch({ commands: ['vibes'], statuses: ['sideways'], text: '' });

		expect(search).toStrictEqual({ commands: undefined, statuses: undefined, text: undefined, sortKey: undefined, sortDirection: undefined });
	});

	test('the runs route drops a sort key naming a column the table cannot order by', () => {
		const { validateSearch } = setupRunsRoute();

		const search = validateSearch({ sortKey: 'packages', sortDirection: 'desc' });

		expect(search).toStrictEqual({ commands: undefined, statuses: undefined, text: undefined, sortKey: undefined, sortDirection: 'desc' });
	});

	test('the runs route drops a sort direction that names neither way a column can run', () => {
		const { validateSearch } = setupRunsRoute();

		const search = validateSearch({ sortKey: 'updatedAt', sortDirection: 'sideways' });

		expect(search).toStrictEqual({ commands: undefined, statuses: undefined, text: undefined, sortKey: 'updatedAt', sortDirection: undefined });
	});
});
