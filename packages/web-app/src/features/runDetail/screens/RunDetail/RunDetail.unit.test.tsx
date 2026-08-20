import { describe, expect, jest, test } from '@jest/globals';
import type { RunView } from '@lightsout/engine';
import { RunStatus } from '@lightsout/engine/contracts';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { RunDetail } from '#src/features/runDetail/index.ts';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';
import { buildRunView } from '#tests/helpers/buildRunView.ts';
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

const runId = 'abcdef0123456789';

const setupRunDetail = ({ overrides = {} }: { overrides?: Partial<RunView> } = {}) => {
	jest.useFakeTimers();

	const view = buildRunView({ overrides });

	renderWithQueryClient({ ui: <RunDetail runId={runId} />, seed: [{ queryKey: [QueryKey.Run, runId], data: view }] });

	return { view };
};

describe('RunDetail', () => {
	test('names the run and says how it ended', () => {
		setupRunDetail({ overrides: { listing: buildRunListing({ title: 'add search', status: RunStatus.Failed }) } });

		const heading = screen.getByRole('heading', { level: 1, name: 'add search' });

		expect(heading.parentElement).toHaveTextContent('failed');
	});

	test('shows the short id the reports print and the harness that did the work', () => {
		setupRunDetail();

		const identity = screen.getByText('abcdef01');

		expect(identity.parentElement).toHaveTextContent('claude-code');
	});

	test('keeps wall time and active time apart, since they are different numbers', () => {
		setupRunDetail({ overrides: { wallMs: 900_000, activeMs: 720_000 } });

		const wall = screen.getByText('wall');

		expect(wall.parentElement).toHaveTextContent('15m 00s');
		expect(screen.getByText('active').parentElement).toHaveTextContent('12m 00s');
	});

	test('reports the run cost when the driver recorded usage', () => {
		setupRunDetail({
			overrides: { usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 900, cacheCreationTokens: 10, costUsd: 12.8, invocations: 4 } },
		});

		const cost = screen.getByText('cost');

		expect(cost.parentElement).toHaveTextContent('$12.80');
	});

	test('leaves the cost blank rather than guessing when the driver reported none', () => {
		setupRunDetail();

		const cost = screen.getByText('cost');

		expect(cost.parentElement).toHaveTextContent('—');
	});

	test('says plainly when a run the manifest still calls running has no process behind it', () => {
		setupRunDetail({ overrides: { listing: buildRunListing({ status: RunStatus.Running, live: false }) } });

		const warning = screen.getByText(/no process stands behind it/);

		expect(warning).toBeInTheDocument();
	});

	test('names the step in flight while a live run is working', () => {
		setupRunDetail({ overrides: { listing: buildRunListing({ status: RunStatus.Running, live: true }), currentStep: 'write-tests' } });

		const current = screen.getByText('write-tests');

		expect(current).toBeInTheDocument();
	});

	test("links a phase's child run back to the coordinator that spawned it", () => {
		setupRunDetail({ overrides: { parent: { runId: 'ffff0000ffff1111', step: 'phase4-run-detail.md', title: 'web-app' } } });

		const back = screen.getByRole('link', { name: 'web-app' });

		expect(back).toHaveAttribute('href', '/runs/ffff0000ffff1111');
	});

	test('offers the overview beside the plan when the run has one', () => {
		setupRunDetail({ overrides: { overview: '.lightsout/plans/web-app/overview.md' } });

		const overview = screen.getByRole('button', { name: /overview: \.lightsout\/plans\/web-app\/overview\.md/ });

		expect(overview).toBeInTheDocument();
	});

	test('names the packages a run was scoped to', () => {
		setupRunDetail({ overrides: { listing: { ...buildRunListing(), packages: ['engine', 'web-app'] } } });

		const scope = screen.getByText('engine · web-app');

		expect(scope).toBeInTheDocument();
	});

	test('hands a reader the command that would resume a run that can be resumed', () => {
		setupRunDetail({ overrides: { listing: { ...buildRunListing({ status: RunStatus.Failed }), resumable: true } } });

		const command = screen.getByText('lightsout resume --run abcdef01');

		expect(command).toBeInTheDocument();
	});

	test('offers no resume command for a run nothing could be resumed from', () => {
		setupRunDetail();

		const command = screen.queryByText(/lightsout resume/);

		expect(command).not.toBeInTheDocument();
	});
});
