import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { testCoverageToThresholdCommand } from '#src/cli/testCoverageToThresholdCommand.ts';
import { type RunManifest, RunStatus } from '#src/contracts/index.ts';
import type { CoverageResult } from '#src/coverage/index.ts';
import { RunLockError } from '#src/runState/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

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
	allowDirty?: boolean;
	existing?: RunManifest;
	onProgress?: (message: string) => void;
}

const mockRunCoveragePipeline = jest.fn<(params: RunCoveragePipelineParams) => Promise<CoverageResult>>();

jest.mock('#src/coverage/index.ts', () => ({ runCoveragePipeline: (params: RunCoveragePipelineParams) => mockRunCoveragePipeline(params) }));
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
	coverageExcludedChangedFiles: [],
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

		expect(pipelineParams()).toEqual(expect.objectContaining({ cwd, maxBatches: 3, allowDirty: false, existing: undefined }));
		expect(logged[0]).toBe('lightsout: test-coverage-to-threshold starting run');
	});

	test('--allow-dirty accepts the standing tree as baseline; without it a run demands a clean tree', async () => {
		const { context } = setupCommand({ args: ['--allow-dirty'] });

		await expect(testCoverageToThresholdCommand(context)).rejects.toThrow(/process\.exit/);

		expect(pipelineParams()).toEqual(expect.objectContaining({ allowDirty: true }));
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
		const { context, exitCodes } = setupCommand({ result: { ok: false, error: 'run parked: harness rate limited or overloaded' } });

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
	test('every batch earns a line — its outcome icon, its id in a fixed column, what became of it, and the files it touched', async () => {
		const { context, logged } = setupCommand({
			result: {
				manifest: manifestOf({
					steps: [
						{ id: 'worklist', status: RunStatus.Passed, attempts: 1 },
						{ id: 'batch-1', status: RunStatus.Passed, attempts: 1, changedFiles: ['src/a.unit.test.ts'] },
						{ id: 'batch-2', status: RunStatus.Failed, attempts: 2 },
					],
				}),
			},
		});

		await expect(testCoverageToThresholdCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain(`✓ ${'batch-1'.padEnd(48)}resolved · 1 file(s)`);
		expect(logged).toContain(`✗ ${'batch-2'.padEnd(48)}failed`);
		// only batches are batches — the worklist step earns no line
		expect(logged.some((line) => line.includes('worklist'))).toBe(false);
	});

	test('a set-aside batch is a decline rather than a failure, and the files it gave up on are named with the agent’s own reason', async () => {
		const { context, logged, exitCodes } = setupCommand({
			result: {
				setAside: [{ batchId: 'batch-1', files: ['src/x.ts'], rationale: ['x.ts reads the clock at import — it needs a seam before it can be tested'] }],
				manifest: manifestOf({ steps: [{ id: 'batch-1', status: RunStatus.Passed, attempts: 1 }] }),
			},
		});

		await expect(testCoverageToThresholdCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged[1]).toBe('\ntest-coverage-to-threshold run-1234 — PASSED · 1 set aside');
		expect(logged).toContain(`⤫ ${'batch-1'.padEnd(48)}declined (1 file(s) set aside)`);
		expect(logged).toContain('\nset aside batch-1');
		expect(logged).toContain('  src/x.ts');
		// the agent's own words: a set-aside a reader cannot read is indistinguishable from skipped work
		expect(logged).toContain('  x.ts reads the clock at import — it needs a seam before it can be tested');
		expect(logged).toContain('  these files likely need source changes — raise coverage by hand or adjust the threshold');
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a parked run takes no final measurement, so it says so instead of printing an unmoved before → after', async () => {
		const { context, logged } = setupCommand({
			result: {
				ok: false,
				error: 'run parked: harness rate limited or overloaded',
				before: [{ scope: 'root', statementsPct: 61, passed: false }],
				after: [{ scope: 'root', statementsPct: 61, passed: false }],
			},
		});

		await expect(testCoverageToThresholdCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('\nno final measure until the run completes — resume to finish and measure');
		expect(logged.join('\n')).not.toMatch(/61 → 61/);
	});

	test('a parked run names where the evidence landed, then what stopped it — on stderr, last', async () => {
		const { context, logged, errors } = setupCommand({ result: { ok: false, error: 'run parked: harness rate limited or overloaded' } });

		await expect(testCoverageToThresholdCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('evidence: .lightsout/runs/run-1234-abcd/');
		expect(errors).toStrictEqual(['\nrun parked: harness rate limited or overloaded']);
	});

	test('a scope measured on only one side still gets a row, its missing half read as zero rather than dropped', async () => {
		const { context, logged } = setupCommand({
			result: { before: [{ scope: 'root', statementsPct: 61, passed: false }], after: [{ scope: 'engine', statementsPct: 96, passed: true }] },
		});

		await expect(testCoverageToThresholdCommand(context)).rejects.toThrow(/process\.exit/);

		// a scope that appeared only at the final measure, and one that vanished before it
		expect(logged.join('\n')).toMatch(/engine\s+0 → 96/);
		expect(logged.join('\n')).toMatch(/root\s+61 → 0/);
	});
});
