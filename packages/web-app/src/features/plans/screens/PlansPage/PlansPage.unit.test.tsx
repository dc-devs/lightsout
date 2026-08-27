import { describe, expect, jest, test } from '@jest/globals';
import type { PlanWorkspaceListing } from '@lightsout/engine';
import { PlanStage } from '@lightsout/engine/contracts';
import { fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { PlansPage } from '#src/features/plans/index.ts';
import { buildPlanWorkspaceListing } from '#tests/helpers/buildPlanWorkspaceListing.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
// The page's query reaches the engine's filesystem reader at the far end of the
// plans server function. Stubbing the reader keeps that module graph off disk;
// the seeded cache is what keeps the fetcher from ever being called.
jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ listPlanWorkspaces: () => Promise.resolve([]) }),
}));
// -------------------------
// Only the pieces that need a live router around them. The page holds its stage
// filter in the URL, so what it reads back and what it writes are exactly what
// this file reads.
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

const drafted = buildPlanWorkspaceListing({ name: 'drafted', stage: PlanStage.Drafted, updatedAt: '2026-01-02T00:00:00.000Z' });
const rough = buildPlanWorkspaceListing({
	name: 'rough',
	stage: PlanStage.NotesOnly,
	hasNotes: true,
	hasPlanFile: false,
	updatedAt: '2026-01-01T00:00:00.000Z',
});

const setupPlansPage = ({ plans = [drafted, rough], search = {} }: { plans?: PlanWorkspaceListing[]; search?: Record<string, unknown> } = {}) => {
	mockNavigate.mockClear();
	mockUseSearch.mockReturnValue(search);

	renderWithQueryClient({ ui: <PlansPage />, seed: [{ queryKey: [QueryKey.PlanWorkspaces], data: plans }] });
};

/** Every body row's plan name, in the order the table drew them. */
const readNames = () =>
	screen
		.getAllByRole('row')
		.slice(1)
		.map((row) => row.querySelectorAll('td')[0]?.textContent);

/**
 * The filter bar's stage trigger.
 *
 * The table's own sortable header carries the same word, and the bar is drawn
 * above the table — so the first control named 'stage' is the filter rather
 * than the column.
 */
const openStageFilter = () => fireEvent.click(screen.getAllByRole('button', { name: /^stage/ })[0]);

/** The stage a reader picked out of that dropdown. */
const pickStage = ({ label }: { label: string }) => {
	openStageFilter();
	fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(`^${label}`) }));
};

describe('PlansPage', () => {
	test('names the page and counts what this repo has settled', () => {
		setupPlansPage();

		expect(screen.getByRole('heading', { level: 1, name: 'Plans' })).toBeInTheDocument();
		expect(screen.getByText(/2 plans$/)).toBeInTheDocument();
	});

	test('lists every workspace when the URL narrows nothing', () => {
		setupPlansPage();

		expect(readNames()).toStrictEqual(['drafted', 'rough']);
	});

	test('narrows to the stage the URL names, so a filtered list is a link somebody can send', () => {
		setupPlansPage({ search: { stage: PlanStage.NotesOnly } });

		expect(readNames()).toStrictEqual(['rough']);
	});

	test('writes the stage a reader picked into the URL, replacing rather than pushing', () => {
		setupPlansPage();

		pickStage({ label: 'notes only' });

		expect(mockNavigate).toHaveBeenCalledWith({ search: { stage: PlanStage.NotesOnly }, replace: true });
	});

	test('drops the key entirely when a reader clears the filter, rather than leaving an empty one behind', () => {
		setupPlansPage({ search: { stage: PlanStage.NotesOnly } });

		pickStage({ label: 'notes only' });

		expect(mockNavigate).toHaveBeenCalledWith({ search: { stage: undefined }, replace: true });
	});

	test('counts how many workspaces sit at each stage, so a reader sees the shape before filtering', () => {
		setupPlansPage();

		openStageFilter();

		expect(screen.getByRole('checkbox', { name: /^drafted/ }).textContent).toBe('drafted1');
	});

	test('says a repo has planned nothing yet, rather than showing an empty table', () => {
		setupPlansPage({ plans: [] });

		expect(screen.getByText('No plans yet.')).toBeInTheDocument();
	});

	test('says instead that the stage matches nothing, when the repo does have plans', () => {
		setupPlansPage({ search: { stage: PlanStage.Implemented } });

		expect(screen.getByText('No plans at this stage.')).toBeInTheDocument();
		expect(screen.queryByText('No plans yet.')).not.toBeInTheDocument();
	});

	test('offers the way back out of a stage that matches nothing', () => {
		setupPlansPage({ search: { stage: PlanStage.Implemented } });

		fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));

		expect(mockNavigate).toHaveBeenCalledWith({ search: { stage: undefined }, replace: true });
	});
});
