import { describe, expect, jest, test } from '@jest/globals';
import type { RunListing } from '@lightsout/engine';
import { RunStatus } from '@lightsout/engine/contracts';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { RunList } from '#src/features/runs/index.ts';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';
import { renderWithQueryClient } from '#tests/helpers/renderWithQueryClient.tsx';

// Mocked Imports
// -------------------------
jest.mock('@tanstack/react-router', () => ({
	Link: ({ to, params, children, className }: { to: string; params?: Record<string, string>; children: ReactNode; className?: string }) => (
		<a href={Object.entries(params ?? {}).reduce((path, [name, value]) => path.replace(`$${name}`, value), to)} className={className}>
			{children}
		</a>
	),
}));
// -------------------------

const setupRunList = ({ runs = [buildRunListing()] }: { runs?: RunListing[] } = {}) => {
	jest.useFakeTimers();
	jest.setSystemTime(new Date('2026-01-01T00:03:00.000Z'));
	renderWithQueryClient({ ui: <RunList />, seed: [{ queryKey: [QueryKey.Runs], data: runs }] });
};

describe('RunList', () => {
	test('says so plainly when the repo has no run state yet', () => {
		setupRunList({ runs: [] });

		const empty = screen.getByText(/no runs yet/i);

		expect(empty).toBeInTheDocument();
	});

	test('renders one row per run, in the order the engine returned them', () => {
		setupRunList({
			runs: [buildRunListing({ runId: 'newer0000000', title: 'newer run' }), buildRunListing({ runId: 'older0000000', title: 'older run' })],
		});

		const rows = screen.getAllByRole('link');

		expect(rows.map((row) => row.textContent?.slice(0, 9))).toStrictEqual(['newer run', 'older run']);
	});

	test('a row carries the short id, when it last moved and how far its steps got', () => {
		setupRunList();

		const row = screen.getByRole('link');

		expect(row.textContent).toContain('abcdef01');
		expect(row.textContent).toContain('3 minutes ago');
		expect(row.textContent).toContain('2/3 steps');
	});

	test('a row shows the cost when the run reported usage', () => {
		setupRunList({ runs: [buildRunListing({ costUsd: 1.5 })] });

		const cost = screen.getByText('$1.50');

		expect(cost).toBeInTheDocument();
	});

	test('a row shows no cost when the driver reported none', () => {
		setupRunList();

		const cost = screen.queryByText(/^\$/);

		expect(cost).not.toBeInTheDocument();
	});

	test('a row links to the run detail route for its own id', () => {
		setupRunList();

		const row = screen.getByRole('link');

		expect(row).toHaveAttribute('href', '/repo/runs/abcdef0123456789');
	});

	test('a row carries the status badge, with the live dot when a process stands behind the run', () => {
		setupRunList({ runs: [buildRunListing({ status: RunStatus.Running, live: true })] });

		const badge = screen.getByText('running');

		expect(badge.className).toContain('text-status-running');
	});
});
