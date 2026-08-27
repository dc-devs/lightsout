import { describe, expect, jest, test } from '@jest/globals';
import type { ConfigView, FrictionRecord, RunListing, StandardsView } from '@lightsout/engine';
import { PipelineKind, RunStatus } from '@lightsout/engine/contracts';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { RepoHealth } from '#src/features/repo/index.ts';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// Standards, friction and config reach this page through `useQuery` rather than
// through the cache alone, so an unseeded one of them would run its real server
// function and read the filesystem. Each is left hanging here, which is exactly
// the pending state the page is built to render around.
const mockGetStandards = jest.fn<() => Promise<StandardsView>>();
const mockGetFriction = jest.fn<() => Promise<FrictionRecord[]>>();
const mockGetConfig = jest.fn<() => Promise<ConfigView>>();

jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({
		getStandards: () => mockGetStandards(),
		getFriction: () => mockGetFriction(),
		getConfig: () => mockGetConfig(),
		// The open-plans tile subscribes to this; a query left hanging is the dash it renders while nothing has arrived.
		listPlanWorkspaces: () => new Promise(() => {}),
	}),
}));
// -------------------------
// Every run on this page is a link into the run detail, and a link needs a live
// router to resolve a path. A plain anchor keeps the assertions about where a
// row points rather than about the routing library.
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------

/** A query that never answers — how this file holds the three subscriptions the page renders without. */
const neverAnswers = <TData,>(): Promise<TData> => new Promise<TData>(() => {});

const millisecondsPerDay = 24 * 60 * 60 * 1000;

/** A timestamp inside or outside the page's trailing week, stated in days rather than as a fixed date. */
const daysAgo = ({ days }: { days: number }) => new Date(Date.now() - days * millisecondsPerDay).toISOString();

interface SetupParams {
	/** `null` for a deployment that found no repository — an explicit `undefined` would be filled back in with the path. */
	repoRoot?: string | null;
	runs?: RunListing[];
}

const setupRepoHealth = ({ repoRoot = '/repos/lightsout', runs = [buildRunListing()] }: SetupParams = {}) => {
	const mockWriteText = jest.fn<(text: string) => Promise<void>>();

	mockWriteText.mockResolvedValue();
	mockGetStandards.mockReturnValue(neverAnswers());
	mockGetFriction.mockReturnValue(neverAnswers());
	mockGetConfig.mockReturnValue(neverAnswers());
	// jsdom implements the DOM, not the platform around it: navigator has no
	// clipboard at all, so the property is defined rather than spied on.
	Object.defineProperty(navigator, 'clipboard', { value: { writeText: mockWriteText }, configurable: true });
	renderWithQueryClient({
		ui: <RepoHealth />,
		seed: [
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot: repoRoot ?? undefined } },
			{ queryKey: [QueryKey.Runs], data: runs },
		],
	});

	return { mockWriteText };
};

/** One card on the page, so a row is asserted against the panel it belongs to rather than against the whole page. */
const readCard = ({ title }: { title: string }) => within(screen.getByRole('heading', { level: 3, name: title }).closest('section') as HTMLElement);

describe('RepoHealth', () => {
	test('says a deployment found no repository, rather than drawing health over somebody else’s runs', () => {
		setupRepoHealth({ repoRoot: null });

		const notice = screen.getByText(/No lightsout repo found above this directory/);

		expect(notice).toBeInTheDocument();
	});

	test('mounts nothing else on that page, since every panel below is about a repo there is none of', () => {
		setupRepoHealth({ repoRoot: null });

		expect(screen.queryByRole('heading', { level: 1, name: 'Health' })).not.toBeInTheDocument();
		expect(screen.queryByRole('heading', { name: 'Needs you' })).not.toBeInTheDocument();
		expect(screen.queryByRole('heading', { name: 'Recent runs' })).not.toBeInTheDocument();
	});

	test('names the page and the repository it is about', () => {
		setupRepoHealth({ repoRoot: '/repos/other-project' });

		expect(screen.getByRole('heading', { level: 1, name: 'Health' })).toBeInTheDocument();
		expect(screen.getByText('/repos/other-project')).toBeInTheDocument();
	});
});

describe('RepoHealth needs-you panel', () => {
	test('says nothing is waiting when every run finished on its own', () => {
		setupRepoHealth({ runs: [buildRunListing({ status: RunStatus.Passed })] });

		const none = screen.getByText('Nothing is waiting on you.');

		expect(none).toBeInTheDocument();
	});

	test('lists a stopped run the engine says resume would pick up', () => {
		setupRepoHealth({ runs: [buildRunListing({ title: 'add search', status: RunStatus.Failed, resumable: true })] });

		const row = readCard({ title: 'Needs you' }).getByRole('link', { name: 'add search' });

		expect(row).toHaveAttribute('href', '/repo/runs/abcdef0123456789');
	});

	test('hands that run the command that picks it up, naming the run itself', async () => {
		const { mockWriteText } = setupRepoHealth({ runs: [buildRunListing({ runId: '9876543210fedcba', status: RunStatus.Failed, resumable: true })] });

		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Copy resume' }));
		});

		expect(mockWriteText).toHaveBeenCalledWith('lightsout resume --run 98765432');
	});

	test('lists an escalated run too, which resume deliberately refuses and a person has to answer', () => {
		setupRepoHealth({ runs: [buildRunListing({ title: 'raise coverage', status: RunStatus.Escalated, resumable: false })] });

		const row = readCard({ title: 'Needs you' }).getByRole('link', { name: 'raise coverage' });

		expect(row).toBeInTheDocument();
	});

	test('sends that escalated run to its own page instead of offering resume, because resume is not what it needs', () => {
		setupRepoHealth({ runs: [buildRunListing({ status: RunStatus.Escalated, resumable: false })] });

		const action = readCard({ title: 'Needs you' }).getByRole('link', { name: 'Read the escalation →' });

		expect(action).toHaveAttribute('href', '/repo/runs/abcdef0123456789');
		expect(screen.queryByRole('button', { name: 'Copy resume' })).not.toBeInTheDocument();
	});

	test('leaves a phase child out, so a coordinator and its phase never both ask for the same attention', () => {
		setupRepoHealth({
			runs: [
				buildRunListing({ runId: 'aaaaaaaa11111111', title: 'phase 3', status: RunStatus.Failed, resumable: true, parentRunId: 'bbbbbbbb22222222' }),
				buildRunListing({ runId: 'bbbbbbbb22222222', title: 'the whole plan', status: RunStatus.Failed, resumable: true }),
			],
		});

		const rows = readCard({ title: 'Needs you' })
			.getAllByRole('link')
			.map((link) => link.textContent);

		expect(rows).toStrictEqual(['the whole plan']);
	});
});

describe('RepoHealth recent runs', () => {
	test('says how a repo starts when it has never run anything', () => {
		setupRepoHealth({ runs: [] });

		const empty = screen.getByText('No runs yet.');

		expect(empty).toBeInTheDocument();
	});

	test('lists what happened, newest first, whatever order the reader listed them in', () => {
		setupRepoHealth({
			runs: [
				buildRunListing({ runId: '1111111111111111', title: 'oldest', updatedAt: daysAgo({ days: 3 }) }),
				buildRunListing({ runId: '2222222222222222', title: 'newest', updatedAt: daysAgo({ days: 1 }) }),
			],
		});

		const titles = readCard({ title: 'Recent runs' })
			.getAllByRole('link')
			.map((link) => link.textContent);

		expect(titles).toStrictEqual(['See all runs →', 'newest', 'oldest']);
	});

	test('holds the glance to eight rows, however many runs a repo has', () => {
		setupRepoHealth({
			runs: Array.from({ length: 12 }, (_, index) =>
				buildRunListing({ runId: `run${index}`.padEnd(16, '0'), title: `run ${index}`, updatedAt: daysAgo({ days: index }) }),
			),
		});

		const titles = readCard({ title: 'Recent runs' })
			.getAllByRole('link')
			.map((link) => link.textContent)
			.filter((title) => title?.startsWith('run '));

		expect(titles).toHaveLength(8);
	});

	test('leaves a phase child out of the glance, so one eight-phase run fills one row rather than eight', () => {
		setupRepoHealth({
			runs: [
				buildRunListing({ runId: 'aaaaaaaa11111111', title: 'phase 1', parentRunId: 'bbbbbbbb22222222' }),
				buildRunListing({ runId: 'bbbbbbbb22222222', title: 'the whole plan' }),
			],
		});

		const titles = readCard({ title: 'Recent runs' })
			.getAllByRole('link')
			.map((link) => link.textContent);

		expect(titles).toStrictEqual(['See all runs →', 'the whole plan']);
	});

	test('names the command a reader typed rather than the pipeline the manifest records', () => {
		setupRepoHealth({ runs: [buildRunListing({ pipeline: PipelineKind.Phases })] });

		const command = readCard({ title: 'Recent runs' }).getByText('implement · phased');

		expect(command).toBeInTheDocument();
	});

	test('offers the full runs list as the way out of a glance', () => {
		setupRepoHealth();

		const link = readCard({ title: 'Recent runs' }).getByRole('link', { name: 'See all runs →' });

		expect(link).toHaveAttribute('href', '/repo/runs');
	});
});
