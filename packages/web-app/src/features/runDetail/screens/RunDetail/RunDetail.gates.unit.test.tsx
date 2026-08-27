import { describe, expect, jest, test } from '@jest/globals';
import type { RunView } from '@lightsout/engine';
import { fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryKey } from '#src/common/constants/QueryKey.ts';
import { RunDetail } from '#src/features/runDetail/index.ts';
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

const passingGate = { kind: 'test', group: 'engine', command: 'pnpm test:unit', exitCode: 0, durationMs: 12_000, at: '2026-01-01T00:02:00.000Z' };

const setupGates = ({ overrides = {} }: { overrides?: Partial<RunView> } = {}) => {
	jest.useFakeTimers();
	renderWithQueryClient({
		ui: <RunDetail runId={runId} />,
		seed: [
			{ queryKey: [QueryKey.Run, runId], data: buildRunView({ overrides }) },
			// The page subscribes to the repo lookup rather than suspending on it, so
			// an unseeded key would answer "no repo" on the render every test reads.
			{ queryKey: [QueryKey.RepoRoot], data: { repoRoot: '/repos/lightsout' } },
		],
	});
	// The gates have a tab of their own now, and a tab strip selects on the press
	// rather than on the release.
	fireEvent.mouseDown(screen.getByRole('tab', { name: 'Gates' }));
};

describe('RunDetail gate evidence', () => {
	test('says so when the run recorded no gate commands at all', () => {
		setupGates();

		const empty = screen.getByText('No gate commands were recorded for this run.');

		expect(empty).toBeInTheDocument();
	});

	test('counts the commands, the flake re-runs and the scoped skips', () => {
		setupGates({ overrides: { gateTotals: { commands: 12, reruns: 1, skipped: 3 } } });

		const totals = screen.getByText('12 commands · 1 flake re-run · 3 skipped');

		expect(totals).toBeInTheDocument();
	});

	test('shows a failing command without being asked, captured output and all', () => {
		setupGates({
			overrides: {
				gates: [
					{
						kind: 'check',
						group: 'root',
						command: 'pnpm check',
						exitCode: 1,
						durationMs: 42_000,
						outputTail: 'error TS2339: Property does not exist',
						at: '2026-01-01T00:01:00.000Z',
					},
				],
			},
		});

		const output = screen.getByText('error TS2339: Property does not exist');

		expect(output).toBeInTheDocument();
	});

	test('keeps passing commands out of the way until a reader asks for them', () => {
		setupGates({ overrides: { gates: [passingGate] } });

		const passing = screen.queryByText('pnpm test:unit');

		expect(passing).not.toBeInTheDocument();
	});

	test('shows the passing commands once a reader asks', () => {
		setupGates({ overrides: { gates: [passingGate] } });

		fireEvent.click(screen.getByRole('button', { name: 'Show 1 passing gate' }));

		expect(screen.getByText('pnpm test:unit')).toBeInTheDocument();
	});

	test('marks a flake re-run and a scoped skip for what they are', () => {
		setupGates({ overrides: { gates: [{ ...passingGate, exitCode: undefined, rerun: true, skipped: true, reason: 'no "check" script' }] } });

		fireEvent.click(screen.getByRole('button', { name: 'Show 1 passing gate' }));

		expect(screen.getByText('flake re-run')).toBeInTheDocument();
		expect(screen.getByText('skipped · no "check" script')).toBeInTheDocument();
	});

	test('marks a skip whose reason went unrecorded as a skip all the same', () => {
		setupGates({ overrides: { gates: [{ ...passingGate, exitCode: undefined, skipped: true }] } });

		fireEvent.click(screen.getByRole('button', { name: 'Show 1 passing gate' }));

		expect(screen.getByText('skipped')).toBeInTheDocument();
	});

	test('names the pipeline step each command ran under', () => {
		setupGates({ overrides: { gates: [{ ...passingGate, step: 'write-tests' }] } });

		fireEvent.click(screen.getByRole('button', { name: 'Show 1 passing gate' }));

		expect(screen.getByText('pnpm test:unit').parentElement).toHaveTextContent(/engine.*write-tests.*pnpm test:unit/);
	});

	test('leaves a dash where a command ran outside any step', () => {
		setupGates({ overrides: { gates: [passingGate] } });

		fireEvent.click(screen.getByRole('button', { name: 'Show 1 passing gate' }));

		expect(screen.getByText('pnpm test:unit').parentElement).toHaveTextContent(/engine.*—.*pnpm test:unit/);
	});

	test('says nothing was captured for a command that recorded no output', () => {
		setupGates({ overrides: { gates: [passingGate] } });

		fireEvent.click(screen.getByRole('button', { name: 'Show 1 passing gate' }));

		expect(screen.getByText('Nothing was captured for this command.')).toBeInTheDocument();
	});
});
