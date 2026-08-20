import { describe, expect, test } from '@jest/globals';
import { RunStatus } from '@lightsout/engine/contracts';
import { render, screen } from '@testing-library/react';
import { RunStatusBadge } from '#src/common/components/ui/RunStatusBadge.tsx';

const setupRunStatusBadge = ({ status, live }: { status: RunStatus; live?: boolean }) => {
	const { container } = render(<RunStatusBadge status={status} live={live} />);

	return { container };
};

describe('RunStatusBadge', () => {
	test.each([
		{ status: RunStatus.Pending, label: 'pending', token: 'bg-muted' },
		{ status: RunStatus.Running, label: 'running', token: 'text-status-running' },
		{ status: RunStatus.Passed, label: 'passed', token: 'text-status-passed' },
		{ status: RunStatus.Failed, label: 'failed', token: 'text-status-failed' },
		{ status: RunStatus.PausedRateLimit, label: 'paused · rate limit', token: 'text-status-paused' },
		{ status: RunStatus.PausedBudget, label: 'paused · budget', token: 'text-status-paused' },
		{ status: RunStatus.Escalated, label: 'escalated', token: 'text-status-escalated' },
	])('names $label and reaches its colour token', ({ status, label, token }) => {
		setupRunStatusBadge({ status });

		const badge = screen.getByText(label);

		expect(badge.className).toContain(token);
	});

	test('shows a pulsing dot while a live process stands behind the run', () => {
		const { container } = setupRunStatusBadge({ status: RunStatus.Running, live: true });

		const dot = container.querySelector('[aria-hidden="true"]');

		expect(dot).toBeInTheDocument();
	});

	test('shows no dot when no process is live', () => {
		const { container } = setupRunStatusBadge({ status: RunStatus.Running });

		const dot = container.querySelector('[aria-hidden="true"]');

		expect(dot).not.toBeInTheDocument();
	});
});
