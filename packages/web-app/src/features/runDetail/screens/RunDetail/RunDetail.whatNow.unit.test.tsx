import { describe, expect, jest, test } from '@jest/globals';
import type { RunView } from '@lightsout/engine';
import { RunStatus } from '@lightsout/engine/contracts';
import { screen } from '@testing-library/react';
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

const setupWhatNow = ({
	status = RunStatus.Failed,
	resumable = false,
	repoFound = true,
	overrides = {},
}: {
	status?: RunStatus;
	resumable?: boolean;
	repoFound?: boolean;
	overrides?: Partial<RunView>;
} = {}) => {
	jest.useFakeTimers();

	// No tab is chosen: the what-now line sits under the header, above the tabs.
	renderWithQueryClient({
		ui: <RunDetail runId={runId} />,
		seed: [
			{
				queryKey: [QueryKey.Run, runId],
				data: buildRunView({ overrides: { listing: { ...buildRunListing({ status, live: true }), resumable }, ...overrides } }),
			},
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot: repoFound ? '/repos/lightsout' : undefined } },
		],
	});
};

describe('RunDetail what now', () => {
	test.each([
		{ status: RunStatus.Passed, name: 'passed' },
		{ status: RunStatus.Pending, name: 'has not started' },
	])('says nothing about a next move for a run that $name', ({ status }) => {
		setupWhatNow({ status, overrides: { steps: [buildRunStep()] } });

		const line = screen.queryByText(/stopped at|working on/);

		expect(line).not.toBeInTheDocument();
	});

	test('names the step a live run is working on', () => {
		setupWhatNow({ status: RunStatus.Running, overrides: { steps: [buildRunStep({ overrides: { id: 'write-tests', status: RunStatus.Running } })] } });

		const line = screen.getByText('working on');

		expect(line.parentElement).toHaveTextContent('write-tests');
	});

	test('names the step a failed run stopped at, and only the first line of what it said', () => {
		setupWhatNow({
			overrides: {
				steps: [
					buildRunStep({ overrides: { id: 'implement' } }),
					buildRunStep({
						overrides: { id: 'write-tests', status: RunStatus.Failed, error: 'the check gate came back non-zero\nat packages/engine/src/a.ts:12' },
					}),
				],
			},
		});

		const line = screen.getByText('stopped at');

		expect(line.parentElement).toHaveTextContent('write-tests');
		expect(screen.getByText('the check gate came back non-zero')).toBeInTheDocument();
		expect(screen.queryByText(/packages\/engine\/src\/a\.ts:12/)).not.toBeInTheDocument();
	});

	test.each([
		{ status: RunStatus.PausedRateLimit, name: 'a rate-limit pause', sentence: /resume when the window resets/ },
		{ status: RunStatus.PausedBudget, name: 'a budget pause', sentence: /batch ceiling you set/ },
		{ status: RunStatus.Escalated, name: 'an escalation', sentence: /asked for a human decision/ },
	])('explains $name in words, since the badge alone says nothing a reader can act on', ({ status, sentence }) => {
		setupWhatNow({ status, overrides: { steps: [buildRunStep({ overrides: { id: 'write-tests', status } })] } });

		const explanation = screen.getByText(sentence);

		expect(explanation).toBeInTheDocument();
	});

	test('falls back to the step the manifest still has open when no step recorded a status of its own', () => {
		setupWhatNow({ status: RunStatus.Escalated, overrides: { steps: [], currentStep: 'implement-supervisor' } });

		const line = screen.getByText('stopped at');

		expect(line.parentElement).toHaveTextContent('implement-supervisor');
	});

	test('says so plainly when a stopped run never got as far as naming a step', () => {
		setupWhatNow({ status: RunStatus.Failed, overrides: { steps: [], currentStep: null } });

		const line = screen.getByText('stopped at');

		expect(line.parentElement).toHaveTextContent('nothing yet');
	});

	test('offers no resume command on a machine with no repo, where it would name a run nothing has', () => {
		setupWhatNow({ resumable: true, repoFound: false, overrides: { steps: [buildRunStep({ overrides: { status: RunStatus.Failed } })] } });

		const command = screen.queryByText(/lightsout resume/);

		expect(command).not.toBeInTheDocument();
		expect(screen.getByText('stopped at')).toBeInTheDocument();
	});
});
