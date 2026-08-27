import { describe, expect, jest, test } from '@jest/globals';
import type { RunListing } from '@lightsout/engine';
import { PipelineKind, RunStatus } from '@lightsout/engine/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BadgeVariant } from '#src/common/constants/BadgeVariant.ts';
import { SortDirection } from '#src/common/constants/SortDirection.ts';
import { type RunFilters, RunsTable } from '#src/features/runs/index.ts';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';

// Mocked Imports
// -------------------------
// The feature barrel reaches the engine's filesystem reader at the far end of
// the runs server function. Nothing here calls it — the table is handed its
// rows — so stubbing the reader just keeps the module graph off disk.
jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ listRuns: () => Promise.resolve([]) }),
}));
// -------------------------
// Only the link, which needs a live router around it to resolve a path.
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

/** Two rows that differ in every column a reader can order by, so one pair proves all seven orders. */
const alpha = buildRunListing({
	runId: 'aaaa0000aaaa0000',
	title: 'alpha',
	pipeline: PipelineKind.Implement,
	status: RunStatus.Passed,
	stepsPassed: 1,
	changedFileCount: 9,
	costUsd: 5,
	updatedAt: '2026-01-02T00:00:00.000Z',
});

const beta = buildRunListing({
	runId: 'bbbb0000bbbb0000',
	title: 'beta',
	pipeline: PipelineKind.Refactor,
	status: RunStatus.Failed,
	stepsPassed: 2,
	changedFileCount: 1,
	updatedAt: '2026-01-01T00:00:00.000Z',
});

/**
 * Every body row's title, in the order the table drew them.
 *
 * The table always carries a disclosure column, so the chevron cell is first
 * and the status badge second — the title is the third cell across.
 */
const readTitles = () =>
	screen
		.getAllByRole('row')
		.slice(1)
		.map((row) => row.querySelectorAll('td')[2]?.textContent);

const setupRunsTable = ({
	runs = [buildRunListing()],
	filters = {},
	commandsDisabled,
	clearable = true,
}: {
	runs?: RunListing[];
	filters?: Partial<RunFilters>;
	commandsDisabled?: boolean;
	clearable?: boolean;
} = {}) => {
	const onSort = jest.fn<(params: { key: string; direction: SortDirection }) => void>();
	const onClearFilters = jest.fn<() => void>();

	render(
		<RunsTable
			runs={runs}
			filters={{ commands: [], statuses: [], ...filters }}
			onSort={onSort}
			onClearFilters={clearable ? onClearFilters : undefined}
			commandsDisabled={commandsDisabled}
		/>,
	);

	return { onClearFilters, onSort };
};

describe('RunsTable', () => {
	test('makes each run’s title the way into its own evidence', () => {
		setupRunsTable({ runs: [buildRunListing({ runId: 'ffff0000ffff0000', title: 'raise coverage' })] });

		const open = screen.getByRole('link', { name: 'raise coverage' });

		expect(open).toHaveAttribute('href', '/repo/runs/ffff0000ffff0000');
	});

	test('says which command produced a run rather than which pipeline ran it', () => {
		setupRunsTable({ runs: [buildRunListing({ pipeline: PipelineKind.Phases })] });

		const command = screen.getByText('implement · phased');

		expect(command).toBeInTheDocument();
	});

	test('keeps only the runs whose titles say what a reader typed', () => {
		setupRunsTable({ runs: [alpha, beta], filters: { text: 'BET' } });

		const titles = readTitles();

		expect(titles).toStrictEqual(['beta']);
	});

	test('keeps only the runs a reader’s chosen command produced', () => {
		setupRunsTable({ runs: [alpha, beta], filters: { commands: ['refactor'] } });

		const titles = readTitles();

		expect(titles).toStrictEqual(['beta']);
	});

	test('keeps only the runs that ended the way a reader chose', () => {
		setupRunsTable({ runs: [alpha, beta], filters: { statuses: [BadgeVariant.Passed] } });

		const titles = readTitles();

		expect(titles).toStrictEqual(['alpha']);
	});

	test.each([
		{ sortKey: 'status', expected: ['beta', 'alpha'] },
		{ sortKey: 'title', expected: ['alpha', 'beta'] },
		{ sortKey: 'command', expected: ['alpha', 'beta'] },
		{ sortKey: 'steps', expected: ['alpha', 'beta'] },
		{ sortKey: 'files', expected: ['beta', 'alpha'] },
		{ sortKey: 'cost', expected: ['beta', 'alpha'] },
		{ sortKey: 'updatedAt', expected: ['beta', 'alpha'] },
	])('orders the rows by what the $sortKey column says it sorts on', ({ sortKey, expected }) => {
		setupRunsTable({ runs: [alpha, beta], filters: { sortKey, sortDirection: SortDirection.Ascending } });

		const titles = readTitles();

		expect(titles).toStrictEqual(expected);
	});

	test('reports the column a reader pressed, so the page can write it to the URL', () => {
		const { onSort } = setupRunsTable({ runs: [alpha, beta] });

		const header = screen.getByRole('button', { name: 'updated' });
		fireEvent.click(header);

		expect(onSort).toHaveBeenCalledWith({ key: 'updatedAt', direction: SortDirection.Ascending });
	});

	test('prints what a run cost when its driver reported one', () => {
		setupRunsTable({ runs: [buildRunListing({ costUsd: 5 })] });

		const cost = screen.getByText('$5.00');

		expect(cost).toBeInTheDocument();
	});

	test('prints a dash rather than a zero for a run whose driver reported no cost', () => {
		setupRunsTable({ runs: [buildRunListing()] });

		const cost = screen.getByText('—');

		expect(cost).toBeInTheDocument();
	});

	test('tags each package a run was scoped to', () => {
		setupRunsTable({ runs: [buildRunListing({ packages: ['engine', 'web-app'] })] });

		const tag = screen.getByText('web-app');

		expect(tag).toBeInTheDocument();
	});

	test('counts the steps a run got through against the steps it had', () => {
		setupRunsTable({ runs: [buildRunListing({ stepsPassed: 1 })] });

		const steps = screen.getByText('1/3');

		expect(steps).toBeInTheDocument();
	});

	test('offers the command that would pick a stopped run back up', () => {
		setupRunsTable({ runs: [buildRunListing({ runId: 'ffff0000ffff0000', resumable: true })] });

		const resume = screen.getByRole('button', { name: /Copy resume/ });

		expect(resume).toBeInTheDocument();
	});

	test('drops that command when no repo was found, since it names a run only this machine has', () => {
		setupRunsTable({ runs: [buildRunListing({ resumable: true })], commandsDisabled: true });

		const resume = screen.queryByRole('button', { name: /Copy resume/ });

		expect(resume).not.toBeInTheDocument();
	});

	test('offers nothing to copy for a run the manifest says cannot be resumed', () => {
		setupRunsTable({ runs: [buildRunListing({ resumable: false })] });

		const resume = screen.queryByRole('button', { name: /Copy resume/ });

		expect(resume).not.toBeInTheDocument();
	});

	test('folds a coordinator’s phase runs under it rather than listing them alongside', () => {
		setupRunsTable({
			runs: [
				buildRunListing({ runId: 'cccc0000cccc0000', title: 'ship the redesign', pipeline: PipelineKind.Phases }),
				buildRunListing({ runId: 'dddd0000dddd0000', title: 'phase 5', parentRunId: 'cccc0000cccc0000' }),
			],
		});

		const titles = readTitles();

		expect(titles).toStrictEqual(['ship the redesign']);
	});

	test('shows those phase runs when a reader opens the coordinator', () => {
		setupRunsTable({
			runs: [
				buildRunListing({ runId: 'cccc0000cccc0000', title: 'ship the redesign', pipeline: PipelineKind.Phases }),
				buildRunListing({ runId: 'dddd0000dddd0000', title: 'phase 5', parentRunId: 'cccc0000cccc0000' }),
			],
		});

		const open = screen.getByRole('button', { name: 'Expand phases' });
		fireEvent.click(open);

		expect(readTitles()).toStrictEqual(['ship the redesign', 'phase 5']);
	});

	test('closes the coordinator again when a reader presses it a second time', () => {
		setupRunsTable({
			runs: [
				buildRunListing({ runId: 'cccc0000cccc0000', title: 'ship the redesign', pipeline: PipelineKind.Phases }),
				buildRunListing({ runId: 'dddd0000dddd0000', title: 'phase 5', parentRunId: 'cccc0000cccc0000' }),
			],
		});

		fireEvent.click(screen.getByRole('button', { name: 'Expand phases' }));
		fireEvent.click(screen.getByRole('button', { name: 'Collapse phases' }));

		expect(readTitles()).toStrictEqual(['ship the redesign']);
	});

	test('gives a run that started no phases nothing to open', () => {
		setupRunsTable({ runs: [buildRunListing()] });

		const open = screen.queryByRole('button', { name: 'Expand phases' });

		expect(open).not.toBeInTheDocument();
	});

	test('tells a repo with no run state at all how to make one', () => {
		setupRunsTable({ runs: [] });

		const empty = screen.getByText('No runs yet.');

		expect(empty).toBeInTheDocument();
	});

	test('names the three commands that put a first run there', () => {
		setupRunsTable({ runs: [] });

		const steps = screen.getByText(/Plan the work/);

		expect(steps.parentElement?.textContent).toContain('/implement');
	});

	test('says the filters excluded everything rather than that the repo has nothing', () => {
		setupRunsTable({ runs: [alpha, beta], filters: { text: 'no such run' } });

		const empty = screen.getByText('No runs match these filters.');

		expect(empty).toBeInTheDocument();
	});

	test('offers the way back out of a filter that matched nothing', () => {
		const { onClearFilters } = setupRunsTable({ runs: [alpha, beta], filters: { text: 'no such run' } });

		const clear = screen.getByRole('button', { name: 'Clear filters' });
		fireEvent.click(clear);

		expect(onClearFilters).toHaveBeenCalledTimes(1);
	});

	test('drops that way out for a consumer whose filters are fixed', () => {
		setupRunsTable({ runs: [alpha, beta], filters: { text: 'no such run' }, clearable: false });

		const clear = screen.queryByRole('button', { name: 'Clear filters' });

		expect(clear).not.toBeInTheDocument();
	});
});
