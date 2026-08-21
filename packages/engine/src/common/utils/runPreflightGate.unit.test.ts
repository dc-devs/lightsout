import { describe, expect, jest, test } from '@jest/globals';
import { runPreflightGate } from '#src/common/utils/runPreflightGate.ts';
import { type LightsoutConfig, RunManifest, RunStatus, type StepRecord } from '#src/contracts/index.ts';

// Mocked Imports
// -------------------------
// The gates shell out to the consumer's own check/test/coverage commands —
// another module's entry point with its own tests, and the one thing that
// cannot run for real here. What this gate owns is observable with it stubbed:
// whether it runs at all, what it counts, and what it does with a red result.

interface RunGatesParams {
	cwd: string;
	config: LightsoutConfig;
	coverage?: boolean;
	runId?: string;
	step?: string;
	onProgress?: (message: string) => void;
}

const mockRunGates = jest.fn<(params: RunGatesParams) => Promise<string | undefined>>();

jest.mock('#src/gates/index.ts', () => ({ runGates: (params: RunGatesParams) => mockRunGates(params) }));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': 'true' } };

/**
 * A minimal stand-in for the run this gate is handed: the structural slice the
 * gate declares, recording every call instead of touching a manifest on disk.
 * `stop` returns a sentinel so the test can tell "the run ended" apart from
 * "proceed" without knowing either pipeline's result type.
 */
const setupPreflightGate = ({ steps = [], gateError, gateProgress }: { steps?: StepRecord[]; gateError?: string; gateProgress?: string } = {}) => {
	mockRunGates.mockImplementation(async ({ onProgress }) => {
		if (gateProgress !== undefined) {
			onProgress?.(gateProgress);
		}

		return gateError;
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

		// undefined is the caller's signal to carry on
		expect(result).toBe(undefined);
		expect(setSteps).toStrictEqual([
			{ id: 'pre-flight', status: 'running', attempts: 1 },
			{ id: 'pre-flight', status: 'passed', attempts: 1 },
		]);
	});

	test('a red baseline ends the run, with the caller sentence in front of the gate output', async () => {
		const { stops, args } = setupPreflightGate({ gateError: 'check: exit 1' });

		const result = await runPreflightGate(args);

		// the run's own stop result is what comes back, so the caller returns it verbatim
		expect(result).toStrictEqual({ stopped: 'failed' });
		expect(stops).toStrictEqual([
			{
				record: { id: 'pre-flight', status: 'running', attempts: 1 },
				status: 'failed',
				error: 'Codebase is not green before refactoring — fix this first.\ncheck: exit 1',
			},
		]);
	});

	test('a step an earlier attempt already passed is skipped rather than re-run', async () => {
		const { setSteps, args } = setupPreflightGate({ steps: [{ id: 'pre-flight', status: RunStatus.Passed, attempts: 1 }] });

		const result = await runPreflightGate(args);

		// a resumed run must not spend the gate's minutes on a baseline it already proved
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
