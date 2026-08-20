import { describe, expect, jest, test } from '@jest/globals';
import type { RunView } from '@lightsout/engine';
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

const usage = { inputTokens: 1_200, outputTokens: 45_000, cacheReadTokens: 2_000_000, cacheCreationTokens: 10, costUsd: 12.8, invocations: 4 };

const setupCost = ({ overrides = {} }: { overrides?: Partial<RunView> } = {}) => {
	jest.useFakeTimers();
	renderWithQueryClient({ ui: <RunDetail runId={runId} />, seed: [{ queryKey: [QueryKey.Run, runId], data: buildRunView({ overrides }) }] });
};

describe('RunDetail agent cost', () => {
	test('says the driver reported no usage rather than showing zeroes', () => {
		setupCost();

		const none = screen.getByText("This run's driver reported no usage.");

		expect(none).toBeInTheDocument();
	});

	test('splits the run total into what was read, written and read from cache', () => {
		setupCost({ overrides: { usage, cacheReadShare: 0.94 } });

		const total = screen.getByText(/in 1\.2k · out 45\.0k · cache-read 2\.0M \(94%\)/);

		expect(total).toHaveTextContent('4 invocations');
	});

	test('leaves the cache share out when the engine could not work one out', () => {
		setupCost({ overrides: { usage } });

		const total = screen.getByText(/cache-read 2\.0M/);

		expect(total.textContent).not.toContain('%');
	});

	test('calls out what the re-emitted reports cost', () => {
		setupCost({ overrides: { usage, rejectedReports: 2 } });

		const retries = screen.getByText('2 rejected reports re-emitted');

		expect(retries).toBeInTheDocument();
	});

	test('breaks the spend down by step', () => {
		setupCost({ overrides: { usage, steps: [buildRunStep({ overrides: { id: 'write-tests', invocations: 2, outputTokens: 3_400, costUsd: 0.75 } })] } });

		const row = screen.getByRole('row', { name: /write-tests/ });

		expect(row).toHaveTextContent('$0.75');
	});

	test('lists an invocation with the model and effort the ledger recorded', () => {
		setupCost({
			overrides: {
				usage,
				agents: [
					{
						at: '2026-01-01T00:01:00.000Z',
						step: 'write-tests',
						model: 'claude-opus-5',
						effort: 'high',
						inputTokens: 10,
						outputTokens: 3_400,
						cacheReadTokens: 5,
						cacheCreationTokens: 1,
						costUsd: 0.75,
					},
				],
			},
		});

		const invocation = screen.getByText('claude-opus-5').parentElement;

		expect(invocation).toHaveTextContent(/write-tests.*high.*out 3\.4k.*\$0\.75/);
	});

	test('lists an invocation a driver named no model for just the same', () => {
		setupCost({
			overrides: {
				usage,
				agents: [
					{
						at: '2026-01-01T00:01:00.000Z',
						step: 'implement-supervisor',
						inputTokens: 10,
						outputTokens: 900,
						cacheReadTokens: 5,
						cacheCreationTokens: 1,
						costUsd: 0.02,
					},
				],
			},
		});

		const invocation = screen.getByText('implement-supervisor').parentElement;

		expect(invocation).toHaveTextContent(/out 900.*\$0\.02/);
	});
});
