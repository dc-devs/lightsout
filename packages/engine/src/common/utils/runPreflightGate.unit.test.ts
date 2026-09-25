import { describe, expect, jest, test } from '@jest/globals';
import { runPreflightGate } from '#src/common/utils/runPreflightGate.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { StepRecord } from '#src/contracts/run/StepRecord.ts';
import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';

// Mocked Imports
// -------------------------
interface RunGatesParams {
	cwd: string;
	config: LightsoutConfig;
	coverage?: boolean;
	runId?: string;
	step?: string;
	onProgress?: (message: string) => void;
}

const mockRunGates = jest.fn<(params: RunGatesParams) => Promise<GateRunResult>>();

jest.mock('#src/gates/runGates.ts', () => ({ runGates: (params: RunGatesParams) => mockRunGates(params) }));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': 'true' } };

/** A stand-in run. `stop` returns a sentinel so a test can tell a stopped run from one that proceeds. */
const setupPreflightGate = ({ steps = [], gateError, gateProgress }: { steps?: StepRecord[]; gateError?: string; gateProgress?: string } = {}) => {
	mockRunGates.mockImplementation(async ({ onProgress }) => {
		if (gateProgress !== undefined) {
			onProgress?.(gateProgress);
		}

		return { error: gateError, failedFamilies: gateError === undefined ? [] : ['check'], crashes: [], timeouts: [], coordination: undefined };
	});

	const progress: string[] = [];
	const setSteps: StepRecord[] = [];
	const stops: Array<{ record: StepRecord; status: RunStatus; error: string }> = [];

	const manifest = RunManifest.parse({
		runId: 'run-1234-abcd',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:03.000Z',
		plan: '',
		harness: 'claude-code',
		status: RunStatus.Running,
		currentStep: null,
		steps,
		changedFiles: [],
	});

	const run = {
		cwd: '/repo',
		config,
		current: () => manifest,
		progress: (message: string) => {
			progress.push(message);
		},
		setStep: async ({ record }: { record: StepRecord }) => {
			setSteps.push(record);
		},
		stop: async (params: { record: StepRecord; status: RunStatus; error: string }) => {
			stops.push(params);

			return { stopped: params.status };
		},
	};

	return {
		progress,
		setSteps,
		stops,
		args: {
			run,
			coverage: true,
			label: 'pre-flight — full gates before any batch',
			redBaselineError: 'Codebase is not green before refactoring — fix this first.',
		},
	};
};

describe('runPreflightGate', () => {
	test('a green baseline marks the step passed and lets the run proceed', async () => {
		const { setSteps, args } = setupPreflightGate();

		const result = await runPreflightGate(args);

		expect(result).toBe(undefined);
		expect(setSteps).toStrictEqual([
			{ id: 'pre-flight', status: 'running', attempts: 1 },
			{ id: 'pre-flight', status: 'passed', attempts: 1 },
		]);
	});

	test('a red baseline ends the run, with the caller sentence in front of the gate output', async () => {
		const { stops, args } = setupPreflightGate({ gateError: 'check: exit 1' });

		const result = await runPreflightGate(args);

		expect(result).toStrictEqual({ stopped: 'failed' });
		expect(stops).toStrictEqual([
			{
				record: { id: 'pre-flight', status: 'running', attempts: 1 },
				status: 'failed',
				error: 'Codebase is not green before refactoring — fix this first.\ncheck: exit 1',
			},
		]);
	});

	test('runPreflightGate: a coordination failure escalates instead of reporting a red baseline', async () => {
		const { setSteps, stops, args } = setupPreflightGate();
		mockRunGates.mockResolvedValue({
			error: 'gates never started',
			failedFamilies: [],
			crashes: [],
			timeouts: [],
			coordination: 'run-9999-zzzz holds the machine in /repo-sibling, held for 31m',
		});

		const result = await runPreflightGate(args);

		expect(result).toStrictEqual({ stopped: 'escalated' });
		expect(stops).toStrictEqual([
			{
				record: { id: 'pre-flight', status: 'running', attempts: 1 },
				status: 'escalated',
				error: expect.stringContaining('run-9999-zzzz holds the machine in /repo-sibling, held for 31m'),
			},
		]);
		expect(stops[0]?.error).not.toContain('Codebase is not green before refactoring');
		// not marked passed, so a later attempt runs the baseline again
		expect(setSteps).toStrictEqual([{ id: 'pre-flight', status: 'running', attempts: 1 }]);
	});

	test('runPreflightGate: a crashed baseline gate escalates instead of reporting a red baseline', async () => {
		const { setSteps, stops, args } = setupPreflightGate();
		mockRunGates.mockResolvedValue({
			error: 'test: exit -1 (jest worker crash)',
			failedFamilies: [],
			crashes: ['test crashed: on every attempt Jest died without reporting a failing test, so this gate never returned a verdict.'],
			timeouts: [],
			coordination: undefined,
		});

		const result = await runPreflightGate(args);

		expect(result).toStrictEqual({ stopped: 'escalated' });
		expect(stops).toStrictEqual([
			{
				record: { id: 'pre-flight', status: 'running', attempts: 1 },
				status: 'escalated',
				error: expect.stringContaining('test crashed: on every attempt Jest died without reporting a failing test, so this gate never returned a verdict.'),
			},
		]);
		expect(stops[0]?.error).not.toContain('Codebase is not green before refactoring');
		// not marked passed, so a later attempt runs the baseline again
		expect(setSteps).toStrictEqual([{ id: 'pre-flight', status: 'running', attempts: 1 }]);
	});

	test('runPreflightGate: a timed-out baseline gate escalates instead of reporting a red baseline', async () => {
		const { setSteps, stops, args } = setupPreflightGate();
		mockRunGates.mockResolvedValue({
			error: 'test: exit -1 (timeout at the 15-minute ceiling)',
			failedFamilies: [],
			crashes: [],
			timeouts: ['test timed out: every attempt ran past the 15-minute gate ceiling (timeouts.gate-minutes), so this gate never returned a verdict.'],
			coordination: undefined,
		});

		const result = await runPreflightGate(args);

		expect(result).toStrictEqual({ stopped: 'escalated' });
		expect(stops).toStrictEqual([
			{
				record: { id: 'pre-flight', status: 'running', attempts: 1 },
				status: 'escalated',
				error: expect.stringContaining(
					'test timed out: every attempt ran past the 15-minute gate ceiling (timeouts.gate-minutes), so this gate never returned a verdict.',
				),
			},
		]);
		expect(stops[0]?.error).not.toContain('Codebase is not green before refactoring');
		// not marked passed, so a later attempt runs the baseline again
		expect(setSteps).toStrictEqual([{ id: 'pre-flight', status: 'running', attempts: 1 }]);
	});

	test('a step an earlier attempt already passed is skipped rather than re-run', async () => {
		const { setSteps, args } = setupPreflightGate({ steps: [{ id: 'pre-flight', status: RunStatus.Passed, attempts: 1 }] });

		const result = await runPreflightGate(args);

		expect(result).toBe(undefined);
		expect(mockRunGates).not.toHaveBeenCalled();
		expect(setSteps).toStrictEqual([]);
	});

	test('a step an earlier attempt failed counts up instead of starting over', async () => {
		const { setSteps, args } = setupPreflightGate({ steps: [{ id: 'pre-flight', status: RunStatus.Failed, attempts: 2 }] });

		await runPreflightGate(args);

		expect(setSteps[0]).toStrictEqual({ id: 'pre-flight', status: 'running', attempts: 3 });
	});

	test("the run's identity and scope reach the gates, and the label announces them", async () => {
		const { progress, args } = setupPreflightGate();

		await runPreflightGate(args);

		expect(mockRunGates).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/repo', config, coverage: true, runId: 'run-1234-abcd', step: 'pre-flight' }));
		expect(progress).toStrictEqual(['pre-flight — full gates before any batch']);
	});

	test('gate progress reaches the run as it happens, not after', async () => {
		const { progress, args } = setupPreflightGate({ gateProgress: 'check: passed' });

		await runPreflightGate(args);

		expect(progress).toStrictEqual(['pre-flight — full gates before any batch', 'check: passed']);
	});
});
