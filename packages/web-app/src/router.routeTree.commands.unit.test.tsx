import { describe, expect, jest, test } from '@jest/globals';
import type { CommandCatalogEntry } from '@lightsout/engine';
import { CommandGroup, CommandRecordKind } from '@lightsout/engine/contracts';
import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { routeTree } from '#src/routeTree.gen.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The route tree loads every route module and everything those modules render,
// and the command routes reach the engine's reader at the far end of that
// chain. Stubbing the reader keeps the whole graph off disk, and lets this file
// state its own two-command catalog rather than asserting against whichever
// commands the engine happens to ship today.
const mockListCommands = jest.fn<() => Promise<CommandCatalogEntry[]>>();

jest.mock('#src/lightsout/index.ts', () => ({
	// Everything else is the real thing: the frozen demo runs Home reads are
	// committed JSON rather than disk this test has to fake.
	...jest.requireActual<typeof import('#src/lightsout/index.ts')>('#src/lightsout/index.ts'),
	getReader: () => ({ listCommands: () => mockListCommands() }),
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
 * The command detail file route, narrowed to what this file reads.
 *
 * The router types these against its own deeply generic route shapes; restating
 * those here would be noise rather than safety, so each entry names only the
 * argument the app's own code passes it and the value it hands back.
 */
interface FilePage {
	options: {
		component: ComponentType;
		notFoundComponent: ComponentType;
		loader: (input: { context: { queryClient: QueryClient }; params: { command: string } }) => Promise<void>;
		head: (input: { params: { command: string } }) => { meta: { title: string }[] };
	};
	useParams: () => { command: string };
}

/**
 * Two commands, spelled here rather than taken from the engine's own catalog.
 *
 * The route's job is to decide whether a word in the path names a command at
 * all and to hand that one entry to the page — so the catalog it decides
 * against belongs to the test, and a command added or renamed in the engine
 * leaves this file alone.
 */
const catalog: CommandCatalogEntry[] = [
	{
		id: 'status',
		cli: 'lightsout status',
		group: CommandGroup.Housekeeping,
		summary: 'Show what lightsout sees in this repo.',
		whenToUse: 'Run it when you come back to a repo and need to know what lightsout thinks is going on.',
		invocations: [{ id: 'status' }],
		flags: [{ name: 'cwd', value: '<path>', meaning: 'which repo to look at', required: false }],
		steps: [],
		records: CommandRecordKind.Nothing,
		related: ['doctor'],
	},
	{
		id: 'implement',
		slash: '/implement',
		cli: 'lightsout implement',
		group: CommandGroup.Build,
		summary: 'Run a graded plan to done, unattended.',
		whenToUse: 'Run it when a plan is graded and you want the work done without watching it.',
		invocations: [{ id: 'implement', note: 'one plan file' }],
		flags: [{ name: 'plan', value: '<path>', meaning: 'the plan to run', required: true }],
		steps: [],
		records: CommandRecordKind.Runs,
		related: ['plan'],
	},
];

const setupCommandRoute = () => {
	mockListCommands.mockResolvedValue(catalog);

	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createRouter({ routeTree, context: { queryClient } });
	const route = (router as unknown as { routesById: Record<string, FilePage> }).routesById['/commands/$command'];

	return { queryClient, route };
};

/**
 * The command detail route, rendered for one word in the path.
 *
 * `Route.useParams()` reads the match a live router is showing, so the word
 * comes from a spy on that one method rather than from a router driven to the
 * path — which is the routing library's behaviour, not this route's.
 *
 * No repo root is seeded, which is the case this page exists for: the manual
 * half is engine source, so it renders for a reader who has installed nothing.
 */
const setupCommandPage = ({ command = 'status' }: { command?: string } = {}) => {
	const { route } = setupCommandRoute();
	jest.spyOn(route, 'useParams').mockReturnValue({ command });
	const Page = route.options.component;

	renderWithQueryClient({
		ui: <Page />,
		seed: [
			{ queryKey: [QueryKey.Commands], data: catalog },
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot: undefined } },
		],
	});
};

/** The same route's answer for a word the catalog carries no command for — what the loader's `notFound()` reaches. */
const setupMissingCommandPage = ({ command = 'no-such-command' }: { command?: string } = {}) => {
	const { route } = setupCommandRoute();
	jest.spyOn(route, 'useParams').mockReturnValue({ command });
	const Page = route.options.notFoundComponent;

	renderWithQueryClient({ ui: <Page /> });
};

// The tree this file drives lives in `routeTree.gen.ts`, which TanStack Router
// writes and the repo lists as generated output — so it is not a subject a test
// may be named after. `router.tsx` is the tree's only consumer, which makes this
// a scenario suite on the router: what the command detail route serves, as
// opposed to the shell and the local zone its sibling suites carry.
describe('routeTree', () => {
	test('the command route names the tab from the path alone, before any query resolves', () => {
		const { route } = setupCommandRoute();

		const head = route.options.head({ params: { command: 'implement' } });

		expect(head.meta).toStrictEqual([{ title: 'implement — lightsout command' }]);
	});

	test('the command route warms the whole catalog, so the page needs no second round trip', async () => {
		const { queryClient, route } = setupCommandRoute();

		await route.options.loader({ context: { queryClient }, params: { command: 'status' } });

		expect(queryClient.getQueryData([QueryKey.Commands])).toStrictEqual(catalog);
	});

	test('the command route turns away a word no command in the catalog answers to', async () => {
		const { queryClient, route } = setupCommandRoute();

		const loading = route.options.loader({ context: { queryClient }, params: { command: 'no-such-command' } });

		await expect(loading).rejects.toStrictEqual({ isNotFound: true });
	});

	test('the command route serves the manual of the command the path names', () => {
		setupCommandPage({ command: 'implement' });

		const heading = screen.getByRole('heading', { level: 1, name: '/implement' });

		expect(heading).toBeInTheDocument();
	});

	test('the command route trails that manual back to the commands list', () => {
		setupCommandPage({ command: 'status' });

		const crumb = screen.getByRole('link', { name: 'Commands' });

		expect(crumb).toHaveAttribute('href', '/commands');
	});

	test('the command route says which word nothing answers to', () => {
		setupMissingCommandPage({ command: 'no-such-command' });

		const notice = screen.getByText('no-such-command');

		expect(notice).toBeInTheDocument();
	});

	test('the command route offers the commands list as the way out of that dead end', () => {
		setupMissingCommandPage();

		const back = screen.getByRole('link', { name: 'pick one from the commands list' });

		expect(back).toHaveAttribute('href', '/commands');
	});
});
