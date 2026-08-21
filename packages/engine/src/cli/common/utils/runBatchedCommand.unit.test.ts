import { describe, expect, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { runBatchedCommand } from '#src/cli/common/utils/runBatchedCommand.ts';
import { type LightsoutConfig, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { RunLockError } from '#src/runState/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const manifestOf = ({ status }: { status: RunStatus }): RunManifest => ({
	runId: 'run-42',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	plan: '',
	harness: 'stub',
	status,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	unreachableChangedFiles: [],
});

interface SeenStart {
	config?: LightsoutConfig;
	maxBatches?: number;
	existing?: unknown;
}

const setupShell = ({
	args = [],
	ok = true,
	status = RunStatus.Passed,
	failWith,
}: {
	args?: string[];
	ok?: boolean;
	status?: RunStatus;
	failWith?: Error;
} = {}) => {
	const result = { ok, manifest: manifestOf({ status }) };
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo();
	const seen: SeenStart = {};
	const printed: unknown[] = [];

	const command = runBatchedCommand({
		flags: parseFlags({ args }),
		cwd,
		command: 'refactor',
		run: async (start) => {
			seen.config = start.config;
			seen.maxBatches = start.maxBatches;
			seen.existing = start.existing;

			if (failWith) {
				throw failWith;
			}

			return result;
		},
		print: ({ result: finished }) => printed.push(finished),
	});

	return { command, seen, printed, ...captured };
};

describe('runBatchedCommand', () => {
	test('resolves the effective config, announces the run, hands off, prints the result, and exits 0 on ok', async () => {
		const { command, seen, printed, logged, exitCodes } = setupShell({ args: ['--max-batches', '2'] });

		await expect(command).rejects.toThrow(/process\.exit/);

		expect(seen.config?.harness).toBe('claude-code');
		expect(seen.maxBatches).toBe(2);
		expect(seen.existing).toBeUndefined();
		expect(logged[0]).toBe('lightsout: refactor starting run');
		expect(printed).toStrictEqual([{ ok: true, manifest: manifestOf({ status: RunStatus.Passed }) }]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a run that broke exits 1, whatever it managed along the way', async () => {
		const { command, exitCodes } = setupShell({ ok: false, status: RunStatus.Failed });

		await expect(command).rejects.toThrow(/process\.exit/);

		expect(exitCodes).toStrictEqual([1]);
	});

	test('a run that stopped at its ceiling exits 2, so a caller can tell it apart from one that broke', async () => {
		const { command, exitCodes } = setupShell({ ok: false, status: RunStatus.PausedBudget });

		await expect(command).rejects.toThrow(/process\.exit/);

		expect(exitCodes).toStrictEqual([2]);
	});

	test('a run parked at a rate-limit wall exits 2 as well — it is waiting, not broken', async () => {
		const { command, exitCodes } = setupShell({ ok: false, status: RunStatus.PausedRateLimit });

		await expect(command).rejects.toThrow(/process\.exit/);

		expect(exitCodes).toStrictEqual([2]);
	});

	test('a --max-batches below one is rejected before the pipeline is asked to do anything', async () => {
		const { command, seen, errors, exitCodes } = setupShell({ args: ['--max-batches', '0'] });

		await expect(command).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toContain(`--max-batches must be a positive integer, got '0'`);
		expect(seen.config).toBeUndefined();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a lock collision is reported in the lock’s own words, not as a crash', async () => {
		const { command, errors, exitCodes } = setupShell({ failWith: new RunLockError('run 9f2 is already running in this repo (pid 4242)') });

		await expect(command).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toContain('run 9f2 is already running in this repo (pid 4242)');
		expect(exitCodes).toStrictEqual([1]);
	});
});
