import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { refactorCommand } from '#src/cli/refactorCommand.ts';
import { type RunManifest, RunStatus } from '#src/contracts/index.ts';
import type { RefactorResult } from '#src/refactor/index.ts';
import { RunLockError } from '#src/runState/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// Mocked Imports
// -------------------------
// The refactor pipeline spawns a harness and rewrites the target repo — another
// module's entry point, covered by its own tests. What this command owns is the
// flags it validates and forwards, the run it resumes, the banner it prints and
// the exit code it ends on, all observable with the pipeline stubbed.

interface RunRefactorPipelineParams {
	cwd: string;
	driver: unknown;
	config: { harness?: string };
	path?: string;
	all?: boolean;
	maxBatches?: number;
	agentReview?: boolean;
	allowDirty?: boolean;
	existing?: RunManifest;
	onProgress?: (message: string) => void;
}

const mockRunRefactorPipeline = jest.fn<(params: RunRefactorPipelineParams) => Promise<RefactorResult>>();

jest.mock('#src/refactor/index.ts', () => ({ runRefactorPipeline: (params: RunRefactorPipelineParams) => mockRunRefactorPipeline(params) }));
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

const setupRefactor = ({
	args = [],
	result,
	failWith,
	parkedRunId,
}: {
	args?: string[];
	result?: Partial<RefactorResult>;
	failWith?: unknown;
	parkedRunId?: string;
} = {}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo();

	if (parkedRunId) {
		mkdirSync(join(cwd, '.lightsout', 'runs', parkedRunId), { recursive: true });
		writeFileSync(
			join(cwd, '.lightsout', 'runs', parkedRunId, 'manifest.json'),
			JSON.stringify(manifestOf({ runId: parkedRunId, status: RunStatus.PausedRateLimit })),
		);
	}

	mockRunRefactorPipeline.mockImplementation(async () => {
		if (failWith !== undefined) {
			throw failWith;
		}

		return { ok: true, declined: [], before: {}, after: {}, manifest: manifestOf(), ...result };
	});

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

/** What the command handed the refactor pipeline. */
const pipelineParams = () => mockRunRefactorPipeline.mock.calls[0]?.[0];

describe('refactorCommand', () => {
	test('hands the pipeline the repo, the subpath, the whole-repo switch and the batch cap', async () => {
		const { context, cwd } = setupRefactor({ args: ['--path', 'src/cli', '--all', '--max-batches', '3'] });

		await expect(refactorCommand(context)).rejects.toThrow(/process\.exit/);

		expect(pipelineParams()).toEqual(expect.objectContaining({ cwd, path: 'src/cli', all: true, maxBatches: 3, existing: undefined }));
	});

	test('with no flags it refactors the whole repo under no cap, reporting only what is new', async () => {
		const { context, logged } = setupRefactor();

		await expect(refactorCommand(context)).rejects.toThrow(/process\.exit/);

		expect(pipelineParams()).toEqual(expect.objectContaining({ path: undefined, all: false, maxBatches: undefined, agentReview: true, allowDirty: false }));
		expect(logged[0]).toBe('lightsout: refactor starting run');
	});

	test('--code-checks turns each batch’s agent review off, the same flag the standards check takes', async () => {
		const { context } = setupRefactor({ args: ['--code-checks'] });

		await expect(refactorCommand(context)).rejects.toThrow(/process\.exit/);

		expect(pipelineParams()).toEqual(expect.objectContaining({ agentReview: false }));
	});

	test('--allow-dirty accepts the standing tree as baseline; without it a run demands a clean tree', async () => {
		const { context } = setupRefactor({ args: ['--allow-dirty'] });

		await expect(refactorCommand(context)).rejects.toThrow(/process\.exit/);

		expect(pipelineParams()).toEqual(expect.objectContaining({ allowDirty: true }));
	});

	test('the resolved harness rides into the config the pipeline runs with', async () => {
		const { context } = setupRefactor();

		await expect(refactorCommand(context)).rejects.toThrow(/process\.exit/);

		expect(pipelineParams()?.config).toEqual(expect.objectContaining({ harness: 'claude-code' }));
	});

	test('a completed run exits 0 and prints the burn-down, so a caller reads success from the exit code', async () => {
		const { context, logged, errors, exitCodes } = setupRefactor({ result: { before: { clone: 3 }, after: { clone: 0 } } });

		await expect(refactorCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged.join('\n')).toMatch(/clone\s+3 → 0/);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a parked run exits 1 — the work is unfinished, whatever it managed along the way', async () => {
		const { context, exitCodes } = setupRefactor({ result: { ok: false, error: 'run parked: harness rate limited or overloaded' } });

		await expect(refactorCommand(context)).rejects.toThrow(/process\.exit/);

		expect(exitCodes).toStrictEqual([1]);
	});

	test('--run resumes the named run: its manifest reaches the pipeline and the banner says so', async () => {
		const { context, logged } = setupRefactor({ args: ['--run', 'run-parked-01'], parkedRunId: 'run-parked-01' });

		await expect(refactorCommand(context)).rejects.toThrow(/process\.exit/);

		expect(pipelineParams()?.existing).toEqual(expect.objectContaining({ runId: 'run-parked-01' }));
		expect(logged[0]).toBe('lightsout: refactor resuming run run-parked-01');
	});

	test('a --run naming no run on disk stops before any work starts', async () => {
		const { context, errors, exitCodes } = setupRefactor({ args: ['--run', 'ghost'] });

		await expect(refactorCommand(context)).rejects.toThrow(/process\.exit/);

		// the id the user typed, and where to look up the real ones
		expect(errors).toStrictEqual([`no run matching 'ghost' — list the runs this repo has with: lightsout status`]);
		expect(mockRunRefactorPipeline).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test.each([{ value: '0' }, { value: '-2' }, { value: 'many' }])(
		'--max-batches $value is rejected before the pipeline is started, because a cap below one would refactor nothing',
		async ({ value }) => {
			const { context, errors, exitCodes } = setupRefactor({ args: ['--max-batches', value] });

			await expect(refactorCommand(context)).rejects.toThrow(/process\.exit/);

			expect(errors.join('\n')).toContain(`--max-batches must be a positive integer, got '${value}'`);
			expect(mockRunRefactorPipeline).not.toHaveBeenCalled();
			expect(exitCodes).toStrictEqual([1]);
		},
	);

	test('another run holding the lock is reported in its own words, not as a crash', async () => {
		const { context, errors, exitCodes } = setupRefactor({ failWith: new RunLockError('run 9f2 is already running in this repo (pid 4242)') });

		await expect(refactorCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toContain('run 9f2 is already running in this repo (pid 4242)');
		expect(exitCodes).toStrictEqual([1]);
	});

	test('any other pipeline failure reaches stderr as its message and exits 1', async () => {
		const { context, errors, exitCodes } = setupRefactor({ failWith: new Error('git tree is dirty — commit or stash first') });

		await expect(refactorCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toContain('git tree is dirty — commit or stash first');
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a thrown non-Error still reports something a human can read', async () => {
		const { context, errors, exitCodes } = setupRefactor({ failWith: 'harness binary not found' });

		await expect(refactorCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toContain('harness binary not found');
		expect(exitCodes).toStrictEqual([1]);
	});

	test('every batch earns a line — its outcome icon, its id in a fixed column, what became of it, and the files it touched', async () => {
		const { context, logged } = setupRefactor({
			result: {
				manifest: manifestOf({
					steps: [
						{ id: 'worklist', status: RunStatus.Passed, attempts: 1 },
						{ id: 'batch-1', status: RunStatus.Passed, attempts: 1, changedFiles: ['src/a.ts', 'src/b.ts'] },
						{ id: 'batch-2', status: RunStatus.Failed, attempts: 2 },
					],
				}),
			},
		});

		await expect(refactorCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain(`✓ ${'batch-1'.padEnd(48)}resolved · 2 file(s)`);
		expect(logged).toContain(`✗ ${'batch-2'.padEnd(48)}failed`);
		// only batches are batches — the worklist step earns no line
		expect(logged.some((line) => line.includes('worklist'))).toBe(false);
	});

	test('a decline is a judgment, not a failure: its own icon, the sites that persist, and the agent’s rationale verbatim', async () => {
		const { context, logged, exitCodes } = setupRefactor({
			result: {
				declined: [{ batchId: 'batch-1', remainingSiteKeys: ['size:a', 'size:b'], rationale: ['splitting this file would break the barrel'] }],
				manifest: manifestOf({ steps: [{ id: 'batch-1', status: RunStatus.Passed, attempts: 1 }] }),
			},
		});

		await expect(refactorCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged[1]).toBe('\nrefactor run-1234 — PASSED · 1 declined');
		expect(logged).toContain(`⤫ ${'batch-1'.padEnd(48)}declined (2 site(s) persist)`);
		expect(logged).toContain('\ndeclined batch-1');
		// the agent's own words: a decline a reader cannot read is indistinguishable from skipped work
		expect(logged).toContain('  splitting this file would break the barrel');
		expect(logged).toContain('  review each site — fix by hand, or accept it as debt: lightsout standards-check --baseline');
		// a run that only declined still completed
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a parked run takes no final check, so it says so instead of printing an unmoved before → after', async () => {
		const { context, logged, errors } = setupRefactor({
			result: {
				ok: false,
				error: 'run parked: harness rate limited or overloaded',
				declined: [{ batchId: 'batch-1', remainingSiteKeys: ['size:a'], rationale: ['splitting this file would break the barrel'] }],
				before: { size: 4 },
				after: { size: 4 },
				manifest: manifestOf({ status: RunStatus.PausedRateLimit, steps: [{ id: 'batch-1', status: RunStatus.Passed, attempts: 1 }] }),
			},
		});

		await expect(refactorCommand(context)).rejects.toThrow(/process\.exit/);

		// an unfinished run has not weighed its declines either, so the count stays off the status line
		expect(logged[1]).toBe('\nrefactor run-1234 — PAUSED-RATE-LIMIT');
		expect(logged).toContain('\nno burn-down until the run completes — resume to finish and measure');
		expect(logged.join('\n')).not.toMatch(/size\s+4 → 4/);
		// and what stopped it is the last thing said, on stderr
		expect(errors).toStrictEqual(['\nrun parked: harness rate limited or overloaded']);
	});

	test('a rule that finished at zero and one that only appeared afterwards both get a row, counted from whichever side has it', async () => {
		const { context, logged } = setupRefactor({ result: { before: { clone: 3 }, after: { 'size-function': 2 } } });

		await expect(refactorCommand(context)).rejects.toThrow(/process\.exit/);

		// a rule missing from a side is nothing found there, not a row the burn-down drops
		expect(logged.join('\n')).toMatch(/clone\s+3 → 0/);
		expect(logged.join('\n')).toMatch(/size-function\s+0 → 2/);
	});

	test('a run that left work in the tree says so, because the engine writes code and never commits it', async () => {
		const { context, logged } = setupRefactor({ result: { manifest: manifestOf({ changedFiles: ['src/a.ts', 'src/b.ts'] }) } });

		await expect(refactorCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('\n2 file(s) changed in the working tree — review and commit; the engine never commits.');
		expect(logged).toContain('evidence: .lightsout/runs/run-1234-abcd/');
	});
});
