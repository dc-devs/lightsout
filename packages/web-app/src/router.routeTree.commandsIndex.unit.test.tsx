import { describe, expect, jest, test } from '@jest/globals';
import type { CommandCatalogEntry } from '@lightsout/engine';
import { CommandGroup, CommandRecordKind } from '@lightsout/engine/contracts';
import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { routeTree } from '#src/routeTree.gen.ts';
import { buildCommandCatalogEntry } from '#tests/helpers/buildCommandCatalogEntry.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The route tree loads every route module and everything those modules render,
// and several of those reach the engine's filesystem reader at the far end of
// that chain. Stubbing the reader keeps the whole graph off disk, and lets this
// file say what the catalog answered so the loader's cache can be checked
// against it.
const mockListCommands = jest.fn<() => Promise<CommandCatalogEntry[]>>();

jest.mock('#src/lightsout/index.ts', () => ({
	// Everything else is the real thing: the frozen demo runs Home reads are
	// committed JSON rather than disk this test has to fake.
	...jest.requireActual<typeof import('#src/lightsout/index.ts')>('#src/lightsout/index.ts'),
	getReader: () => ({ listCommands: () => mockListCommands() }),
}));
// -------------------------
// Only the piece that needs a live router around it is stood in for, so the
// route's own component can be rendered on its own. Everything else — above all
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
 * The commands index route's options, narrowed to what this file reads.
 *
 * The router types these against its own deeply generic route shapes; restating
 * those here would be noise rather than safety, so each entry names only the
 * argument the app's own code passes it and the value it hands back.
 */
interface FilePage {
	options: {
		component: ComponentType;
		head: () => { meta: { title: string }[] };
		loader: (input: { context: { queryClient: QueryClient } }) => Promise<void>;
	};
}

const setupCommandsRoute = ({ commands = [buildCommandCatalogEntry()] }: { commands?: CommandCatalogEntry[] } = {}) => {
	mockListCommands.mockResolvedValue(commands);

	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createRouter({ routeTree, context: { queryClient } });
	const pages = (router as unknown as { routesById: Record<string, FilePage> }).routesById;

	return { commands, page: pages['/commands/'], queryClient };
};

/**
 * The route's page, rendered the way a build with no repo under it serves it.
 *
 * The repo question is seeded as answered-and-empty rather than left out: the
 * card's count line asks it, and an unseeded key would send that query at the
 * real server function instead of proving the page renders without a repo.
 */
const setupCommandsPage = ({ commands = [buildCommandCatalogEntry()] }: { commands?: CommandCatalogEntry[] } = {}) => {
	const { page } = setupCommandsRoute({ commands });
	const Page = page.options.component;

	renderWithQueryClient({
		ui: <Page />,
		seed: [
			{ queryKey: [QueryKey.Commands], data: commands },
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot: undefined } },
		],
	});
};

// The tree this file drives lives in `routeTree.gen.ts`, which TanStack Router
// writes and the repo lists as generated output — so it is not a subject a test
// may be named after. `router.tsx` is the tree's only consumer, which makes this
// a scenario suite on the router: what the commands index route serves, as
// opposed to the shell and the local zone its sibling suites carry.
describe('routeTree', () => {
	test('the commands route names the browser tab after the page it opens', () => {
		const { page } = setupCommandsRoute();

		const meta = page.options.head().meta;

		expect(meta).toStrictEqual([{ title: 'Commands' }]);
	});

	test('the commands route warms the whole catalog before the page renders, so the grid arrives with its cards', async () => {
		const { commands, page, queryClient } = setupCommandsRoute({
			commands: [buildCommandCatalogEntry(), buildCommandCatalogEntry({ id: 'refactor', slash: '/refactor', group: CommandGroup.BurnDown })],
		});

		await page.options.loader({ context: { queryClient } });

		expect(queryClient.getQueryData([QueryKey.Commands])).toStrictEqual(commands);
	});

	test('the commands route opens the page that lists everything lightsout can be asked to do', () => {
		setupCommandsPage();

		const heading = screen.getByRole('heading', { level: 1, name: 'Commands' });

		expect(heading).toBeInTheDocument();
	});

	test('the commands route shelves each command under the group it belongs to', () => {
		setupCommandsPage({
			commands: [
				buildCommandCatalogEntry(),
				buildCommandCatalogEntry({ id: 'refactor', slash: '/refactor', group: CommandGroup.BurnDown }),
				buildCommandCatalogEntry({
					id: 'doctor',
					cli: 'lightsout doctor',
					group: CommandGroup.Housekeeping,
					records: CommandRecordKind.Nothing,
					overrides: { slash: undefined },
				}),
			],
		});

		const groups = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);

		expect(groups).toStrictEqual(['Build', 'Burn down', 'Standards', 'Housekeeping']);
	});

	test('the commands route gives every card a link to that command’s own page', () => {
		setupCommandsPage({
			commands: [buildCommandCatalogEntry(), buildCommandCatalogEntry({ id: 'refactor', slash: '/refactor', group: CommandGroup.BurnDown })],
		});

		const link = screen.getByRole('link', { name: '/refactor' });

		expect(link).toHaveAttribute('href', '/commands/refactor');
	});

	test('the commands route titles a card with the CLI form when the plugin ships no skill for it', () => {
		setupCommandsPage({
			commands: [
				buildCommandCatalogEntry({
					id: 'doctor',
					cli: 'lightsout doctor',
					group: CommandGroup.Housekeeping,
					records: CommandRecordKind.Nothing,
					overrides: { slash: undefined },
				}),
			],
		});

		const link = screen.getByRole('link', { name: 'lightsout doctor' });

		expect(link).toHaveAttribute('href', '/commands/doctor');
	});
});
