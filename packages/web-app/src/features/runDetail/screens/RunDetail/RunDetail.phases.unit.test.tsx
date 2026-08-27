import { describe, expect, jest, test } from '@jest/globals';
import type { RunStepView } from '@lightsout/engine';
import { PipelineKind, RunStatus } from '@lightsout/engine/contracts';
import { fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { RunDetail } from '#src/features/runDetail/index.ts';
import { buildRunListing } from '#tests/helpers/buildRunListing.ts';
import { buildRunStep } from '#tests/helpers/buildRunStep.ts';
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

const setupCoordinator = ({ steps = [], tab }: { steps?: RunStepView[]; tab?: string } = {}) => {
	jest.useFakeTimers();

	renderWithQueryClient({
		ui: <RunDetail runId={runId} />,
		seed: [
			{
				queryKey: [QueryKey.Run, runId],
				data: buildRunView({ overrides: { listing: { ...buildRunListing(), pipeline: PipelineKind.Phases }, steps } }),
			},
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot: '/repos/lightsout' } },
		],
	});

	if (tab !== undefined) {
		// A tab strip selects on the press, not on the release.
		fireEvent.mouseDown(screen.getByRole('tab', { name: tab }));
	}
};

describe('RunDetail coordinator', () => {
	test.each([{ tab: 'Gates' }, { tab: 'Agents' }])('explains an empty $tab tab instead of drawing an empty panel', ({ tab }) => {
		setupCoordinator({ tab });

		const note = screen.getByText(/each phase's child run has its own/);

		expect(note).toBeInTheDocument();
	});

	test('draws no gate panel at all for a coordinator, which ran no commands of its own', () => {
		setupCoordinator({ tab: 'Gates' });

		const panel = screen.queryByRole('heading', { level: 2, name: 'Gate evidence' });

		expect(panel).not.toBeInTheDocument();
	});

	test('draws no cost panel at all for a coordinator, which spent nothing of its own', () => {
		setupCoordinator({ tab: 'Agents' });

		const panel = screen.queryByRole('heading', { level: 2, name: 'Agent cost' });

		expect(panel).not.toBeInTheDocument();
	});

	test('names each phase by its own file and points at the run that implemented it', () => {
		setupCoordinator({
			steps: [
				buildRunStep({
					overrides: { id: 'phase-1', status: RunStatus.Passed, childRunId: 'aaaa1111bbbb2222', planPath: '.lightsout/plans/web-app/phase1-shell.md' },
				}),
			],
		});

		const phase = screen.getByText('phase1-shell.md');

		expect(phase.parentElement).toHaveTextContent('passed');
		expect(screen.getByRole('link', { name: 'aaaa1111' })).toHaveAttribute('href', '/repo/runs/aaaa1111bbbb2222');
	});

	test('falls back to the step id for a phase whose plan path went unrecorded', () => {
		setupCoordinator({ steps: [buildRunStep({ overrides: { id: 'phase-2', childRunId: 'cccc3333dddd4444' } })] });

		const link = screen.getByRole('link', { name: 'cccc3333' });

		expect(link.parentElement).toHaveTextContent('phase-2');
	});

	test('leaves a step that started no child run out of the phase list', () => {
		setupCoordinator({ steps: [buildRunStep({ overrides: { id: 'plan-phases', planPath: '.lightsout/plans/web-app/overview.md' } })] });

		const phase = screen.queryByText('overview.md');

		expect(phase).not.toBeInTheDocument();
	});
});
