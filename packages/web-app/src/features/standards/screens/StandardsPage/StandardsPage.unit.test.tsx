import { describe, expect, test } from '@jest/globals';
import type { StandardsView } from '@lightsout/engine';
import { screen } from '@testing-library/react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { StandardsPage } from '#src/features/standards/index.ts';
import { buildStandardsView } from '#tests/helpers/buildStandardsView.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

const trendPoint = ({ at, path = '.', total, blocking }: { at: string; path?: string; total: number; blocking: number }) => ({
	at,
	path,
	total,
	blocking,
	advisory: total - blocking,
	byRule: [],
});

const setupStandardsPage = ({ overrides = {} }: { overrides?: Partial<StandardsView> } = {}) => {
	renderWithQueryClient({ ui: <StandardsPage />, seed: [{ queryKey: [QueryKey.Standards], data: buildStandardsView({ overrides }) }] });
};

describe('StandardsPage header', () => {
	test('says which subpath the latest check covered, since a scoped run is not a whole-repo one', () => {
		setupStandardsPage({ overrides: { path: 'packages/engine' } });

		const scope = screen.getByText(/^checked packages\/engine/);

		expect(scope).toBeInTheDocument();
	});

	test('shows the timestamp exactly as it was recorded beside the relative reading, which is what cross-referencing a log needs', () => {
		setupStandardsPage({ overrides: { at: '2026-01-01T00:00:00.000Z' } });

		const recorded = screen.getByText('2026-01-01T00:00:00.000Z');

		expect(recorded).toHaveClass('font-mono');
	});

	test('reports the finding counts the engine supplied rather than counting for itself', () => {
		setupStandardsPage({ overrides: { totals: { rules: 12, checked: 9, judgment: 3, blocking: 4, advisory: 7, orphans: 0 } } });

		expect(screen.getByText('4 blocking findings')).toBeInTheDocument();
		expect(screen.getByText('7 advisory findings')).toBeInTheDocument();
	});

	test('says how many rules the repo loads and how they are enforced', () => {
		setupStandardsPage({ overrides: { totals: { rules: 12, checked: 9, judgment: 3, blocking: 0, advisory: 0, orphans: 0 } } });

		const enforcement = screen.getByText('12 rules, 9 by code and 3 by judgment');

		expect(enforcement).toBeInTheDocument();
	});

	test('states how many findings belong to rules no package loads any more', () => {
		setupStandardsPage({ overrides: { totals: { rules: 1, checked: 1, judgment: 0, blocking: 0, advisory: 0, orphans: 2 } } });

		const orphans = screen.getByText(/2 findings belong to rules no package loads/);

		expect(orphans).toBeInTheDocument();
	});

	test('stays silent about orphans when there are none, rather than reporting a zero', () => {
		setupStandardsPage();

		const orphans = screen.queryByText(/belong to rules no package loads/);

		expect(orphans).not.toBeInTheDocument();
	});

	test("prints the snapshot's own notes as they were written, because they are already sentences for a person", () => {
		setupStandardsPage({ overrides: { notes: ['62% of findings sit under packages/generated/ — if that path is generated output, add it to the config'] } });

		const note = screen.getByText(/if that path is generated output/);

		expect(note).toBeInTheDocument();
	});

	test('names the command to run when the repo has never taken a snapshot', () => {
		setupStandardsPage({ overrides: { at: undefined } });

		const command = screen.getByText('lightsout standards-check');

		expect(command).toBeInTheDocument();
	});

	test('still says how many rules are loaded on a repo that has never run a check', () => {
		setupStandardsPage({ overrides: { at: undefined, totals: { rules: 12, checked: 9, judgment: 3, blocking: 0, advisory: 0, orphans: 0 } } });

		const loaded = screen.getByText(/^12 rules loaded/);

		expect(loaded).toBeInTheDocument();
	});
});

describe('StandardsPage trend', () => {
	test('draws the checks this repo has run as two lines', () => {
		setupStandardsPage({
			overrides: {
				trend: [trendPoint({ at: '2026-01-01T00:00:00.000Z', total: 10, blocking: 4 }), trendPoint({ at: '2026-01-02T00:00:00.000Z', total: 6, blocking: 1 })],
			},
		});

		const chart = screen.getByRole('img', { name: 'Open findings over time' });

		expect(chart.querySelectorAll('path')).toHaveLength(2);
	});

	test('says a trend needs two snapshots rather than drawing one dot as a line', () => {
		setupStandardsPage({ overrides: { trend: [trendPoint({ at: '2026-01-01T00:00:00.000Z', total: 10, blocking: 4 })] } });

		const notice = screen.getByText(/1 snapshot of/);

		expect(notice.textContent).toContain('a trend needs at least two');
	});

	test('says as much on a repo with no snapshots at all', () => {
		setupStandardsPage({ overrides: { trend: [] } });

		const notice = screen.getByText(/0 snapshots of/);

		expect(notice).toBeInTheDocument();
	});

	test('plots only the snapshots that checked the same path, and counts the ones it left out', () => {
		setupStandardsPage({
			overrides: {
				path: '.',
				trend: [
					trendPoint({ at: '2026-01-01T00:00:00.000Z', total: 10, blocking: 4 }),
					trendPoint({ at: '2026-01-02T00:00:00.000Z', path: 'packages/engine', total: 3, blocking: 1 }),
					trendPoint({ at: '2026-01-03T00:00:00.000Z', total: 6, blocking: 1 }),
				],
			},
		});

		const omitted = screen.getByText(/1 snapshot of other paths left out/);

		expect(omitted).toBeInTheDocument();
	});

	test('says nothing about omissions when every snapshot checked the same path', () => {
		setupStandardsPage({
			overrides: {
				trend: [trendPoint({ at: '2026-01-01T00:00:00.000Z', total: 10, blocking: 4 }), trendPoint({ at: '2026-01-02T00:00:00.000Z', total: 6, blocking: 1 })],
			},
		});

		const omitted = screen.queryByText(/left out/);

		expect(omitted).not.toBeInTheDocument();
	});

	test('labels the span it drew with the highest count on it', () => {
		setupStandardsPage({
			overrides: {
				trend: [trendPoint({ at: '2026-01-01T00:00:00.000Z', total: 10, blocking: 4 }), trendPoint({ at: '2026-01-02T00:00:00.000Z', total: 6, blocking: 1 })],
			},
		});

		const label = screen.getByText(/peak 10/);

		expect(label).toBeInTheDocument();
	});

	test('draws each line from its own counts, so the blocking line is never the total one wearing its colour', () => {
		setupStandardsPage({
			overrides: {
				trend: [trendPoint({ at: '2026-01-01T00:00:00.000Z', total: 10, blocking: 4 }), trendPoint({ at: '2026-01-02T00:00:00.000Z', total: 6, blocking: 1 })],
			},
		});

		const chart = screen.getByRole('img', { name: 'Open findings over time' });

		expect(chart.querySelector('path.stroke-status-failed')).toHaveAttribute('d', 'M0.0000,0.6000 L1.0000,0.9000');
		expect(chart.querySelector('path.stroke-muted-foreground')).toHaveAttribute('d', 'M0.0000,0.0000 L1.0000,0.4000');
	});

	test('has nothing to draw when every snapshot on record measured another path, and says both why and how many', () => {
		setupStandardsPage({
			overrides: {
				path: 'packages/engine',
				trend: [trendPoint({ at: '2026-01-01T00:00:00.000Z', total: 10, blocking: 4 }), trendPoint({ at: '2026-01-02T00:00:00.000Z', total: 6, blocking: 1 })],
			},
		});

		const notice = screen.getByText(/0 snapshots of/);

		expect(notice.textContent).toContain('a trend needs at least two');
		expect(screen.getByText(/2 snapshots of other paths left out/)).toBeInTheDocument();
	});
});
