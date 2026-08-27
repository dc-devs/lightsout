import { describe, expect, jest, test } from '@jest/globals';
import type { PlanWorkspaceListing } from '@lightsout/engine';
import { PlanGrade, PlanStage } from '@lightsout/engine/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PlansTable } from '#src/features/plans/index.ts';
import { buildPlanWorkspaceListing } from '#tests/helpers/buildPlanWorkspaceListing.ts';

// Mocked Imports
// -------------------------
// The feature barrel reaches the engine's filesystem reader at the far end of
// the plans server function. Nothing here calls it — the table is handed its
// rows — so stubbing the reader just keeps the module graph off disk.
jest.mock('#src/lightsout/index.ts', () => ({
	getReader: () => ({ listPlanWorkspaces: () => Promise.resolve([]) }),
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

/** Two rows that differ in every column a reader can order by, so one pair proves them all. */
const alpha = buildPlanWorkspaceListing({
	name: 'alpha',
	stage: PlanStage.Implemented,
	grade: PlanGrade.A,
	phased: true,
	phaseCount: 3,
	runCount: 9,
	updatedAt: '2026-01-02T00:00:00.000Z',
});

const beta = buildPlanWorkspaceListing({
	name: 'beta',
	stage: PlanStage.Drafted,
	phased: false,
	phaseCount: 0,
	runCount: 1,
	updatedAt: '2026-01-01T00:00:00.000Z',
});

const setupPlansTable = ({ listings = [beta, alpha], empty = <p>nothing here</p> }: { listings?: PlanWorkspaceListing[]; empty?: ReactNode } = {}) => {
	render(<PlansTable listings={listings} empty={empty} />);
};

/** Every body row's plan name, in the order the table drew them. */
const readNames = () =>
	screen
		.getAllByRole('row')
		.slice(1)
		.map((row) => row.querySelectorAll('td')[0]?.textContent);

/** The header a reader clicked to reorder the table. */
const pressHeader = ({ name }: { name: string }) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));

describe('PlansTable', () => {
	test('opens newest first, whatever order the rows were handed over in', () => {
		setupPlansTable();

		expect(readNames()).toStrictEqual(['alpha', 'beta']);
	});

	test('sends each name to that plan’s own page', () => {
		setupPlansTable();

		expect(screen.getByRole('link', { name: 'alpha' })).toHaveAttribute('href', '/repo/plans/alpha');
	});

	test('says how far each plan got, in the stage’s own word', () => {
		setupPlansTable();

		expect(screen.getByText('implemented')).toBeInTheDocument();
		expect(screen.getByText('drafted')).toBeInTheDocument();
	});

	test('shows a plan’s grade, and a dash for one nothing has graded', () => {
		setupPlansTable();

		const [first, second] = screen.getAllByRole('row').slice(1);

		expect({ alpha: first.querySelectorAll('td')[2]?.textContent, beta: second.querySelectorAll('td')[2]?.textContent }).toStrictEqual({
			alpha: 'A',
			beta: '—',
		});
	});

	test('counts a phased plan’s phases and dashes a single plan, which never had any', () => {
		setupPlansTable();

		const [first, second] = screen.getAllByRole('row').slice(1);

		expect({ alpha: first.querySelectorAll('td')[3]?.textContent, beta: second.querySelectorAll('td')[3]?.textContent }).toStrictEqual({
			alpha: '3',
			beta: '—',
		});
	});

	test('reorders itself when a reader presses a column, since the URL owns only the stage filter', () => {
		setupPlansTable();

		pressHeader({ name: 'plan' });

		expect(readNames()).toStrictEqual(['alpha', 'beta']);

		pressHeader({ name: 'plan' });

		expect(readNames()).toStrictEqual(['beta', 'alpha']);
	});

	test('says whatever its caller told it to say when there is nothing to list, since only the caller knows why', () => {
		setupPlansTable({ listings: [], empty: <p>No brainstorm notes yet.</p> });

		expect(screen.getByText('No brainstorm notes yet.')).toBeInTheDocument();
		expect(screen.queryByRole('table')).not.toBeInTheDocument();
	});
});
