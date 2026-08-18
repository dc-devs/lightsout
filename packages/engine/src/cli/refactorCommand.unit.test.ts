import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { refactorCommand } from '@/cli/refactorCommand';
import { type RunManifest, RunStatus } from '@/contracts';
import type { RefactorResult } from '@/refactor';
import { RunLockError } from '@/runState';

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
	existing?: RunManifest;
	onProgress?: (message: string) => void;
}

const mockRunRefactorPipeline = jest.fn<(params: RunRefactorPipelineParams) => Promise<RefactorResult>>();

jest.mock('@/refactor', () => ({ runRefactorPipeline: (params: RunRefactorPipelineParams) => mockRunRefactorPipeline(params) }));
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

		expect(pipelineParams()).toEqual(expect.objectContaining({ path: undefined, all: false, maxBatches: undefined, agentReview: true }));
		expect(logged[0]).toBe('lightsout: refactor starting run');
	});

	test('--code-checks turns each batch’s agent review off, the same flag the standards check takes', async () => {
		const { context } = setupRefactor({ args: ['--code-checks'] });

		await expect(refactorCommand(context)).rejects.toThrow(/process\.exit/);

		expect(pipelineParams()).toEqual(expect.objectContaining({ agentReview: false }));
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
		const { context, exitCodes } = setupRefactor({ result: { ok: false, error: 'run parked: harness rate limit reached' } });

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
});
