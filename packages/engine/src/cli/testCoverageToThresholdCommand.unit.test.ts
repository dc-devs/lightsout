import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { testCoverageToThresholdCommand } from '@/cli/testCoverageToThresholdCommand';
import { type RunManifest, RunStatus } from '@/contracts';
import type { CoverageResult } from '@/coverage';
import { RunLockError } from '@/runState';

// Mocked Imports
// -------------------------
// The coverage pipeline spawns a harness and writes tests into the target repo —
// another module's entry point, covered by its own tests. What this command owns
// is the flags it validates and forwards, the run it resumes, the banner it
// prints and the exit code it ends on, all observable with the pipeline stubbed.

interface RunCoveragePipelineParams {
	cwd: string;
	driver: unknown;
	config: { harness?: string };
	maxBatches?: number;
	existing?: RunManifest;
	onProgress?: (message: string) => void;
}

const mockRunCoveragePipeline = jest.fn<(params: RunCoveragePipelineParams) => Promise<CoverageResult>>();

jest.mock('@/coverage', () => ({ runCoveragePipeline: (params: RunCoveragePipelineParams) => mockRunCoveragePipeline(params) }));
// -------------------------

const manifestOf = (overrides: Partial<RunManifest> = {}): RunManifest => ({
	runId: 'run-1234-abcd',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:03.000Z',
	plan: '',
	harness: 'claude-code',
	status: RunStatus.Passed,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	unreachableChangedFiles: [],
	...overrides,
});

const setupCommand = ({
	args = [],
	result,
	failWith,
	parkedRunId,
	config,
}: {
	args?: string[];
	result?: Partial<CoverageResult>;
	failWith?: unknown;
	parkedRunId?: string;
	config?: Record<string, unknown>;
} = {}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ scripts: { 'test-coverage': 'pnpm test:coverage' }, config });

	if (parkedRunId) {
		mkdirSync(join(cwd, '.lightsout', 'runs', parkedRunId), { recursive: true });
		writeFileSync(
			join(cwd, '.lightsout', 'runs', parkedRunId, 'manifest.json'),
			JSON.stringify(manifestOf({ runId: parkedRunId, pipeline: 'coverage', status: RunStatus.PausedRateLimit })),
		);
	}

	mockRunCoveragePipeline.mockImplementation(async () => {
		if (failWith !== undefined) {
			throw failWith;
		}

		return { ok: true, setAside: [], before: [], after: [], manifest: manifestOf(), ...result };
	});

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

/** What the command handed the coverage pipeline. */
const pipelineParams = () => mockRunCoveragePipeline.mock.calls[0]?.[0];

describe('testCoverageToThresholdCommand', () => {
	test('hands the pipeline the repo and the batch cap, and nothing it was not given', async () => {
		const { context, cwd, logged } = setupCommand({ args: ['--max-batches', '3'] });

		await expect(testCoverageToThresholdCommand(context)).rejects.toThrow(/process\.exit/);

		expect(pipelineParams()).toEqual(expect.objectContaining({ cwd, maxBatches: 3, existing: undefined }));
		expect(logged[0]).toBe('lightsout: test-coverage-to-threshold starting run');
	});

	test('the resolved harness rides into the config the pipeline runs with', async () => {
		const { context } = setupCommand();

		await expect(testCoverageToThresholdCommand(context)).rejects.toThrow(/process\.exit/);

		expect(pipelineParams()?.config).toEqual(expect.objectContaining({ harness: 'claude-code' }));
		expect(pipelineParams()?.maxBatches).toBe(undefined);
	});

	test('a per-command entry named for this command overrides the global harness, model and effort', async () => {
		const { context } = setupCommand({
			config: {
				harness: 'claude-code',
				model: 'opus-x',
				commands: { 'test-coverage-to-threshold': { harness: 'codex', model: 'gpt-x', effort: 'high' } },
			},
		});

		await expect(testCoverageToThresholdCommand(context)).rejects.toThrow(/process\.exit/);

		// the key a user writes in the config is the command word they type — a
		// mismatch would leave the override silently inert
		expect(pipelineParams()?.config).toEqual(expect.objectContaining({ harness: 'codex', model: 'gpt-x', effort: 'high' }));
	});

	test('a completed run exits 0 and prints the coverage it moved', async () => {
		const { context, logged, errors, exitCodes } = setupCommand({
			result: { before: [{ scope: 'root', statementsPct: 61, passed: false }], after: [{ scope: 'root', statementsPct: 96, passed: true }] },
		});

		await expect(testCoverageToThresholdCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged.join('\n')).toMatch(/root\s+61 → 96/);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a parked run exits 1 — the gate is still red, whatever it managed along the way', async () => {
		const { context, exitCodes } = setupCommand({ result: { ok: false, error: 'run parked: harness rate limit reached' } });

		await expect(testCoverageToThresholdCommand(context)).rejects.toThrow(/process\.exit/);

		expect(exitCodes).toStrictEqual([1]);
	});

	test('--run resumes the named run: its manifest reaches the pipeline and the banner says so', async () => {
		const { context, logged } = setupCommand({ args: ['--run', 'run-parked-01'], parkedRunId: 'run-parked-01' });

		await expect(testCoverageToThresholdCommand(context)).rejects.toThrow(/process\.exit/);

		expect(pipelineParams()?.existing).toEqual(expect.objectContaining({ runId: 'run-parked-01' }));
		expect(logged[0]).toBe('lightsout: test-coverage-to-threshold resuming run run-parked-01');
	});

	test('a --run naming no run on disk stops before any work starts', async () => {
		const { context, errors, exitCodes } = setupCommand({ args: ['--run', 'ghost'] });

		await expect(testCoverageToThresholdCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual([`no run matching 'ghost' — list the runs this repo has with: lightsout status`]);
		expect(mockRunCoveragePipeline).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test.each([{ value: '0' }, { value: '-2' }, { value: 'many' }])(
		'--max-batches $value is rejected before the pipeline starts, because a cap below one would write nothing',
		async ({ value }) => {
			const { context, errors, exitCodes } = setupCommand({ args: ['--max-batches', value] });

			await expect(testCoverageToThresholdCommand(context)).rejects.toThrow(/process\.exit/);

			expect(errors.join('\n')).toContain(`--max-batches must be a positive integer, got '${value}'`);
			expect(mockRunCoveragePipeline).not.toHaveBeenCalled();
			expect(exitCodes).toStrictEqual([1]);
		},
	);

	test('another run holding the lock is reported in its own words, not as a crash', async () => {
		const { context, errors, exitCodes } = setupCommand({ failWith: new RunLockError('run 9f2 is already running in this repo (pid 4242)') });

		await expect(testCoverageToThresholdCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toContain('run 9f2 is already running in this repo (pid 4242)');
		expect(exitCodes).toStrictEqual([1]);
	});

	test('any other pipeline failure reaches stderr as its message and exits 1', async () => {
		const { context, errors, exitCodes } = setupCommand({
			failWith: new Error('the coverage gate is opted out ("test-coverage": false) — test-coverage-to-threshold has nothing to run'),
		});

		await expect(testCoverageToThresholdCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toContain('has nothing to run');
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a thrown non-Error still reports something a human can read', async () => {
		const { context, errors, exitCodes } = setupCommand({ failWith: 'harness binary not found' });

		await expect(testCoverageToThresholdCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toContain('harness binary not found');
		expect(exitCodes).toStrictEqual([1]);
	});
});
