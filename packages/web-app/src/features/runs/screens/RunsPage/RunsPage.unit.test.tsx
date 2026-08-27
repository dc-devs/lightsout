import { describe, expect, jest, test } from '@jest/globals';
import type { RunListing } from '@lightsout/engine';
import { PipelineKind, RunStatus } from '@lightsout/engine/contracts';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { RunsPage } from '#src/features/runs/index.ts';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The page reads two query options objects, and the runs one reaches the
// engine's filesystem reader at the far end of the server function behind it.
// Stubbing the reader keeps that module graph off disk; the seeded cache is
// what keeps the fetcher from ever being called.
jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ listRuns: () => Promise.resolve([]) }),
}));
// -------------------------
// Only the pieces that need a live router around them. The page holds its
// filters in the URL, so what it reads back and what it writes are exactly what
// this file reads — everything else about the router stays real.
const mockNavigate = jest.fn<(options: { search: Record<string, unknown>; replace: boolean }) => void>();
const mockUseSearch = jest.fn<() => Record<string, unknown>>();

jest.mock('@tanstack/react-router', () => {
	const actual = jest.requireActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');

	return {
		...actual,
		Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
			<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
				{children}
			</a>
		),
		useSearch: () => mockUseSearch(),
		useNavigate: () => mockNavigate,
	};
});
// -------------------------

/** Two runs a day apart, so the page's own default order is visible in the rows. */
const alpha = buildRunListing({
	runId: 'aaaa0000aaaa0000',
	title: 'alpha',
	pipeline: PipelineKind.Implement,
	status: RunStatus.Passed,
	updatedAt: '2026-01-02T00:00:00.000Z',
});

const beta = buildRunListing({
	runId: 'bbbb0000bbbb0000',
	title: 'beta',
	pipeline: PipelineKind.Refactor,
	status: RunStatus.Failed,
	updatedAt: '2026-01-01T00:00:00.000Z',
});

/** The whole URL the page writes when nothing has been narrowed and nothing reordered. */
const untouchedSearch = { commands: undefined, statuses: undefined, text: undefined, sortKey: 'updatedAt', sortDirection: 'desc' };

/** Every body row's title, in the order the table drew them — the chevron cell is first and the status badge second. */
const readTitles = () =>
	screen
		.getAllByRole('row')
		.slice(1)
		.map((row) => row.querySelectorAll('td')[2]?.textContent);

/**
 * The filter bar's trigger for a named set.
 *
 * The table's own sortable header carries the same word, and the bar is drawn
 * above the table — so the first control whose name starts with it is the
 * filter rather than the column.
 */
const openFilter = ({ name }: { name: string }) => fireEvent.click(screen.getAllByRole('button', { name: new RegExp(`^${name}`) })[0]);

// `repoRoot` is read rather than destructured with a default, because an
// explicit `undefined` is the no-repo case a default parameter would swallow.
const setupRunsPage = (params: { runs?: RunListing[]; search?: Record<string, unknown>; repoRoot?: string } = {}) => {
	const { runs = [alpha, beta], search = {} } = params;
	const repoRoot = Object.hasOwn(params, 'repoRoot') ? params.repoRoot : '/repos/lightsout';

	mockUseSearch.mockReturnValue(search);

	renderWithQueryClient({
		ui: <RunsPage />,
		seed: [
			{ queryKey: [QueryKey.Runs], data: runs },
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot } },
		],
	});
};

describe('RunsPage', () => {
	test('names the page and counts the runs the repo has', () => {
		setupRunsPage({ runs: [alpha, beta] });

		const heading = screen.getByRole('heading', { level: 1, name: 'Runs' });

		expect(heading.parentElement?.parentElement?.textContent).toContain('2 runs');
	});

	test('says the rows are frozen demo data when no repo was found, so a visitor never reads them as their own', () => {
		setupRunsPage({ repoRoot: undefined });

		const description = screen.getByText(/demo data/);

		expect(description.textContent).toContain("frozen from lightsout's own repository");
	});

	test('drops the resume commands with no repo, since each names a run only this repository has', () => {
		setupRunsPage({ runs: [buildRunListing({ resumable: true })], repoRoot: undefined });

		const resume = screen.queryByRole('button', { name: /Copy resume/ });

		expect(resume).not.toBeInTheDocument();
	});

	test('offers those commands once a repo is open', () => {
		setupRunsPage({ runs: [buildRunListing({ resumable: true })] });

		const resume = screen.getByRole('button', { name: /Copy resume/ });

		expect(resume).toBeInTheDocument();
	});

	test('shows the newest run first until a reader says otherwise', () => {
		setupRunsPage({ runs: [beta, alpha] });

		const titles = readTitles();

		expect(titles).toStrictEqual(['alpha', 'beta']);
	});

	test('narrows the table to the commands the URL names', () => {
		setupRunsPage({ search: { commands: ['refactor'] } });

		const titles = readTitles();

		expect(titles).toStrictEqual(['beta']);
	});

	test('narrows the table to the statuses the URL names', () => {
		setupRunsPage({ search: { statuses: ['passed'] } });

		const titles = readTitles();

		expect(titles).toStrictEqual(['alpha']);
	});

	test('narrows the table to the text the URL carries', () => {
		setupRunsPage({ search: { text: 'bet' } });

		const titles = readTitles();

		expect(titles).toStrictEqual(['beta']);
	});

	test('orders the table the way the URL asks', () => {
		setupRunsPage({ runs: [beta, alpha], search: { sortKey: 'title', sortDirection: 'asc' } });

		const titles = readTitles();

		expect(titles).toStrictEqual(['alpha', 'beta']);
	});

	test('writes a chosen command to the URL, replacing rather than pushing, so back leaves the page', () => {
		setupRunsPage();

		openFilter({ name: 'command' });
		fireEvent.click(screen.getByRole('checkbox', { name: /refactor/ }));

		expect(mockNavigate).toHaveBeenCalledWith({ search: { ...untouchedSearch, commands: ['refactor'] }, replace: true });
	});

	test('writes a chosen status to the URL beside it', () => {
		setupRunsPage();

		openFilter({ name: 'status' });
		fireEvent.click(screen.getByRole('checkbox', { name: /failed/ }));

		expect(mockNavigate).toHaveBeenCalledWith({ search: { ...untouchedSearch, statuses: ['failed'] }, replace: true });
	});

	test('drops a cleared set from the URL entirely rather than leaving an empty key behind', () => {
		setupRunsPage({ search: { commands: ['refactor'] } });

		openFilter({ name: 'command' });
		fireEvent.click(screen.getByRole('checkbox', { name: /refactor/ }));

		expect(mockNavigate).toHaveBeenCalledWith({ search: untouchedSearch, replace: true });
	});

	test('calls a run that has not started what a reader would call it rather than by its colour', () => {
		setupRunsPage({ runs: [buildRunListing({ status: RunStatus.Pending })] });

		openFilter({ name: 'status' });

		expect(screen.getByRole('checkbox', { name: /pending/ })).toBeInTheDocument();
	});

	test('says how many runs each value covers, counted over every row rather than the shown ones', () => {
		setupRunsPage({ runs: [alpha, beta], search: { commands: ['refactor'] } });

		openFilter({ name: 'command' });

		expect(screen.getByRole('checkbox', { name: /implement/ })).toHaveTextContent('1');
	});

	test('writes what a reader typed once they pause, rather than once per keystroke', async () => {
		setupRunsPage();

		const box = screen.getByRole('searchbox', { name: 'Filter runs by title' });
		fireEvent.change(box, { target: { value: 'be' } });
		fireEvent.change(box, { target: { value: 'bet' } });

		await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
		expect(mockNavigate).toHaveBeenCalledWith({ search: { ...untouchedSearch, text: 'bet' }, replace: true });
	});

	test('drops an emptied text box from the URL rather than narrowing to the empty string', async () => {
		setupRunsPage({ search: { text: 'bet' } });

		const box = screen.getByRole('searchbox', { name: 'Filter runs by title' });
		fireEvent.change(box, { target: { value: '' } });

		await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ search: untouchedSearch, replace: true }));
	});

	test('carries what is already typed along when a reader picks a value before the pause is up', () => {
		setupRunsPage();

		fireEvent.change(screen.getByRole('searchbox', { name: 'Filter runs by title' }), { target: { value: 'bet' } });
		openFilter({ name: 'command' });
		fireEvent.click(screen.getByRole('checkbox', { name: /refactor/ }));

		expect(mockNavigate).toHaveBeenCalledWith({ search: { ...untouchedSearch, commands: ['refactor'], text: 'bet' }, replace: true });
	});

	test('writes the column a reader pressed to the URL', () => {
		setupRunsPage();

		fireEvent.click(screen.getByRole('button', { name: 'run' }));

		expect(mockNavigate).toHaveBeenCalledWith({ search: { ...untouchedSearch, sortKey: 'title', sortDirection: 'asc' }, replace: true });
	});

	test('writes no order at all for a URL naming a column the table cannot order by', () => {
		setupRunsPage({ search: { sortKey: 'packages' } });

		openFilter({ name: 'command' });
		fireEvent.click(screen.getByRole('checkbox', { name: /refactor/ }));

		expect(mockNavigate).toHaveBeenCalledWith({ search: { ...untouchedSearch, commands: ['refactor'], sortKey: undefined }, replace: true });
	});

	test('clears every filter from the URL when a reader takes the way out of a filter that matched nothing', () => {
		setupRunsPage({ search: { commands: ['refactor'], text: 'no such run' } });

		fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

		expect(mockNavigate).toHaveBeenCalledWith({ search: untouchedSearch, replace: true });
	});
});
