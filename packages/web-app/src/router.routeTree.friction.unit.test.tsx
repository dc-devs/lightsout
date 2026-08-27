import { describe, expect, jest, test } from '@jest/globals';
import type { FrictionRecord, RunListing } from '@lightsout/engine';
import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { fireEvent, screen, within } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { routeTree } from '#src/routeTree.gen.ts';
import { buildFrictionRecord } from '#tests/helpers/buildFrictionRecord.ts';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The route tree loads every route module and everything those modules render,
// and this route reaches the engine's filesystem reader at the far end of that
// chain. Stubbing the reader keeps the whole graph off disk, and lets this file
// state its own log rather than asserting against whatever this repo's agents
// have reported today.
const mockGetFriction = jest.fn<() => Promise<FrictionRecord[]>>();
const mockListRuns = jest.fn<() => Promise<RunListing[]>>();

jest.mock('#src/lightsout/index.ts', () => ({
	// Everything else is the real thing: the frozen demo runs the landing page
	// reads are committed JSON rather than disk this test has to fake.
	...jest.requireActual<typeof import('#src/lightsout/index.ts')>('#src/lightsout/index.ts'),
	getReader: () => ({ getFriction: () => mockGetFriction(), listRuns: () => mockListRuns() }),
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
 * The friction file route, narrowed to what this file reads.
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

const runId = 'abcdef0123456789';

/** Three entries an agent could plausibly have written, differing in area, kind and wording. */
const records = [
	buildFrictionRecord({
		area: 'plan',
		kind: 'friction',
		detail: 'the plan named a file that is not on disk',
		at: '2026-01-01T00:01:00.000Z',
		runId,
		step: 'implement',
	}),
	buildFrictionRecord({
		area: 'environment',
		kind: 'decision',
		detail: 'chose the narrower barrel',
		at: '2026-01-01T00:02:00.000Z',
		runId,
		step: 'write-tests',
	}),
	buildFrictionRecord({ area: 'plan', detail: 'the coverage report was stale', at: '2026-01-01T00:03:00.000Z', runId: '9876543210fedcba', step: 'refactor' }),
];

const setupFrictionRoute = ({ friction = records, runs = [buildRunListing()] }: { friction?: FrictionRecord[]; runs?: RunListing[] } = {}) => {
	mockGetFriction.mockResolvedValue(friction);
	mockListRuns.mockResolvedValue(runs);

	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createRouter({ routeTree, context: { queryClient } });
	const route = (router as unknown as { routesById: Record<string, FilePage> }).routesById['/repo/friction'];

	return { friction, queryClient, route, runs };
};

/**
 * The page on its own, over a log and a runs list this file states.
 *
 * `runs: null` leaves that query hanging, which is the case the page is built
 * for: it subscribes to the runs rather than suspending on them, because they
 * only put a title beside a run id and no filter reads them.
 */
const setupFrictionPage = ({
	friction = records,
	runs = [buildRunListing({ runId, title: 'add search' })],
}: {
	friction?: FrictionRecord[];
	runs?: RunListing[] | null;
} = {}) => {
	const { route } = setupFrictionRoute({ friction, runs: runs ?? [] });

	if (runs === null) {
		mockListRuns.mockReturnValue(new Promise<RunListing[]>(() => {}));
	}

	const Page = route.options.component;

	renderWithQueryClient({
		ui: <Page />,
		seed: [{ queryKey: [QueryKey.Friction], data: friction }, ...(runs === null ? [] : [{ queryKey: [QueryKey.Runs], data: runs }])],
	});
};

/** The one chip a reader pressed, by the area it names. */
const pressArea = ({ area }: { area: string }) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${area}`) }));

/** What a reader typed into the filter box. */
const typeFilter = ({ text }: { text: string }) => fireEvent.change(screen.getByLabelText('Filter friction by what was reported'), { target: { value: text } });

/** The details on screen, in the order the table lists them. */
const readDetails = () =>
	screen
		.getAllByRole('row')
		.slice(1)
		.map((row) => within(row).getAllByRole('cell').at(-1)?.textContent);

describe('routeTree', () => {
	test('the friction route names the tab before any query resolves', () => {
		const { route } = setupFrictionRoute();

		const head = route.options.head();

		expect(head.meta).toStrictEqual([{ title: 'Friction' }]);
	});

	test('the friction route warms the log the page suspends on', async () => {
		const { friction, queryClient, route } = setupFrictionRoute();

		await route.options.loader({ context: { queryClient } });

		expect(queryClient.getQueryData([QueryKey.Friction])).toStrictEqual(friction);
	});

	test('the friction route warms the runs too, which are what put a title beside a run id', async () => {
		const { queryClient, route, runs } = setupFrictionRoute();

		await route.options.loader({ context: { queryClient } });

		expect(queryClient.getQueryData([QueryKey.Runs])).toStrictEqual(runs);
	});

	test('the friction route names the page and counts what is on record', () => {
		setupFrictionPage();

		expect(screen.getByRole('heading', { level: 1, name: 'Friction' })).toBeInTheDocument();
		expect(screen.getByText(/3 entries$/)).toBeInTheDocument();
	});

	test('the friction route lists the newest entry first, whatever order the log was written in', () => {
		setupFrictionPage();

		const details = readDetails();

		expect(details).toStrictEqual(['the coverage report was stale', 'chose the narrower barrel', 'the plan named a file that is not on disk']);
	});

	test('the friction route names the step an entry came out of', () => {
		setupFrictionPage({ friction: [records[1]] });

		const step = screen.getByText('write-tests');

		expect(step).toBeInTheDocument();
	});

	test('the friction route reads an entry that named no kind as friction, which is what an omitted kind means', () => {
		setupFrictionPage({ friction: [records[2]] });

		const kind = screen.getByText('friction');

		expect(kind).toBeInTheDocument();
	});

	test('the friction route puts a title beside the run an entry came from', () => {
		setupFrictionPage({ friction: [records[0]] });

		const link = screen.getByRole('link', { name: /add search/ });

		expect(link).toHaveAttribute('href', `/repo/runs/${runId}`);
	});

	test('the friction route keeps an entry whose run directory was deleted, under its short id alone', () => {
		setupFrictionPage({ friction: [records[2]] });

		expect(screen.getByText('98765432')).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: /98765432/ })).not.toBeInTheDocument();
	});

	test('the friction route names a run by its short id while the runs are still loading, since no filter waits on them', () => {
		setupFrictionPage({ friction: [records[0]], runs: null });

		expect(screen.getByText('abcdef01')).toBeInTheDocument();
		expect(screen.queryByRole('link')).not.toBeInTheDocument();
	});

	test('the friction route counts each area on its own chip, so a reader sees the shape before filtering', () => {
		setupFrictionPage();

		const chips = screen.getAllByRole('button', { name: /^(plan|prompt|standards|environment|other)/ }).map((chip) => chip.textContent);

		expect(chips).toStrictEqual(['plan2', 'prompt0', 'standards0', 'environment1', 'other0']);
	});

	test('the friction route narrows the table to the area a reader pressed', () => {
		setupFrictionPage();

		pressArea({ area: 'environment' });

		expect(readDetails()).toStrictEqual(['chose the narrower barrel']);
	});

	test('the friction route lets a reader press that chip again to see everything, which is the way back out', () => {
		setupFrictionPage();

		pressArea({ area: 'environment' });
		pressArea({ area: 'environment' });

		expect(readDetails()).toHaveLength(3);
	});

	test('the friction route narrows the table to what a reader typed', () => {
		setupFrictionPage();

		typeFilter({ text: 'coverage report' });

		expect(readDetails()).toStrictEqual(['the coverage report was stale']);
	});

	test('the friction route says a repo has recorded nothing, rather than showing an empty table', () => {
		setupFrictionPage({ friction: [] });

		const empty = screen.getByText('No friction on record.');

		expect(empty).toBeInTheDocument();
	});

	test('the friction route says instead that the filters match nothing, when the log itself is not empty', () => {
		setupFrictionPage();

		typeFilter({ text: 'a phrase nobody wrote' });

		expect(screen.getByText('No entries match these filters.')).toBeInTheDocument();
		expect(screen.queryByText('No friction on record.')).not.toBeInTheDocument();
	});

	test('the friction route closes with the command that feeds this log back into the pipeline', () => {
		setupFrictionPage();

		const command = screen.getByText('lightsout improve --engine <path>');

		expect(command).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Copy improve command' })).toBeInTheDocument();
	});
});
