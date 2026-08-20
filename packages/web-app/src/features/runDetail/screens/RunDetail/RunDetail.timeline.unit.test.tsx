import { describe, expect, jest, test } from '@jest/globals';
import type { RunStepView } from '@lightsout/engine';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { RunDetail } from '#src/features/runDetail/index.ts';
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

const setupTimeline = ({ steps = [], activeMs = 600_000 }: { steps?: RunStepView[]; activeMs?: number } = {}) => {
	jest.useFakeTimers();
	renderWithQueryClient({
		ui: <RunDetail runId={runId} />,
		seed: [{ queryKey: [QueryKey.Run, runId], data: buildRunView({ overrides: { steps, activeMs } }) }],
	});
};

describe('RunDetail timeline', () => {
	test('says so when the run has not recorded a step yet', () => {
		setupTimeline();

		const empty = screen.getByText('No steps recorded yet.');

		expect(empty).toBeInTheDocument();
	});

	test('gives each step a segment as wide as its share of the working time', () => {
		setupTimeline({ steps: [buildRunStep({ overrides: { id: 'implement', durationMs: 300_000 } })], activeMs: 600_000 });

		const segment = screen.getByRole('link', { name: 'implement' });

		expect(segment).toHaveStyle({ width: '50%' });
	});

	test('keeps a step with no recorded duration wide enough to click', () => {
		setupTimeline({ steps: [buildRunStep({ overrides: { id: 'write-tests', durationMs: undefined } })] });

		const segment = screen.getByRole('link', { name: 'write-tests' });

		expect(segment).toHaveStyle({ width: '3%' });
	});

	test("measures against the run's own working time even when none was recorded", () => {
		setupTimeline({ steps: [buildRunStep({ overrides: { id: 'implement', durationMs: 0 } })], activeMs: 0 });

		const segment = screen.getByRole('link', { name: 'implement' });

		expect(segment).toHaveStyle({ width: '3%' });
	});

	test("points at the step's own card, so clicking a segment goes to its evidence", () => {
		setupTimeline({ steps: [buildRunStep({ overrides: { id: 'batch-01:size-function' } })] });

		const segment = screen.getByRole('link', { name: 'batch-01:size-function' });

		expect(segment).toHaveAttribute('href', '#step-batch-01:size-function');
	});
});
