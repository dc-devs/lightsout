import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, jest } from '@jest/globals';
import type { Driver } from '@/drivers';
import { RunLockError } from '@/runState';
import { loadConfig } from '@/common/utils/loadConfig';
import { runPipelineOrFailFast } from '@/cli/common/utils/runPipelineOrFailFast';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { getRejectionError } from '@tests/helpers/getRejectionError';

/** A stub agent whose final message is not a report at all — the run fails without throwing. */
const garbageDriver: Driver = {
	name: 'stub',
	invoke: async () => ({ text: 'not a report', exitCode: 0 }),
};

/**
 * Both halves of the fail-fast response: the message on stderr and the exit
 * itself. The real process.exit never returns — a mock that returned would let
 * the catch fall through and rethrow the RunLockError it promised to swallow.
 */
const captureFailFast = () => {
	const errors: string[] = [];
	const exitCodes: (number | string | null | undefined)[] = [];

	jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
		errors.push(String(args[0]));
	});

	jest.spyOn(process, 'exit').mockImplementation((code?: number | string | null): never => {
		exitCodes.push(code);

		throw new Error('process.exit');
	});

	return { errors, exitCodes };
};

/**
 * A real consumer repo the pipeline can run in. `lockedByPid` plants a lock the
 * pipeline will collide with on the way in.
 */
const setupPipelineCall = async ({ lockedByPid }: { lockedByPid?: number } = {}) => {
	const { errors, exitCodes } = captureFailFast();
	const cwd = setupConsumerRepo();

	if (lockedByPid !== undefined) {
		mkdirSync(join(cwd, '.lightsout'), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'lock.json'), JSON.stringify({ pid: lockedByPid, runId: 'already-running', startedAt: '2026-01-01T00:00:00.000Z' }));
	}

	return { cwd, config: await loadConfig({ cwd }), errors, exitCodes };
};

/**
 * A cwd that is a file, not a directory: the lock's parent directory cannot be
 * created, so the pipeline throws a plain filesystem error — the class of
 * failure that must NOT be swallowed as a clean fail-fast.
 */
const setupUnusableCwd = async () => {
	const { errors, exitCodes } = captureFailFast();
	const repo = setupConsumerRepo({ git: false });

	return { cwd: join(repo, 'plan.md'), config: await loadConfig({ cwd: repo }), errors, exitCodes };
};

test('runPipelineOrFailFast: a live run lock is a clean fail-fast — the message on stderr, exit 1, no stack', async () => {
	const { cwd, config, errors, exitCodes } = await setupPipelineCall({ lockedByPid: process.pid });

	await expect(runPipelineOrFailFast({ cwd, planPath: 'plan.md', driver: garbageDriver, config })).rejects.toThrow(/process\.exit/);

	expect(exitCodes).toStrictEqual([1]);
	expect(errors.length).toBe(1);
	// the message is preceded by a blank line so it stands clear of the run output
	expect(errors[0] ?? '').toMatch(/^\n/);
	expect(errors[0] ?? '').toMatch(/another lightsout run is active in this repo: run already-running/);
});

test('runPipelineOrFailFast: the pipeline result is handed back untouched when the run completes', async () => {
	const { cwd, config, errors, exitCodes } = await setupPipelineCall();

	const result = await runPipelineOrFailFast({ cwd, planPath: 'plan.md', driver: garbageDriver, config });

	// a garbage agent report fails the run — a failed run is a returned result,
	// not a fail-fast
	expect(result.ok).toBe(false);
	expect(typeof result.manifest.runId).toBe('string');
	expect(exitCodes).toStrictEqual([]);
	expect(errors).toStrictEqual([]);
});

test('runPipelineOrFailFast: any other error propagates untouched — no message, no exit', async () => {
	const { cwd, config, errors, exitCodes } = await setupUnusableCwd();

	const error = await getRejectionError({ promise: runPipelineOrFailFast({ cwd, planPath: 'plan.md', driver: garbageDriver, config }) });

	// anything that is not a lock conflict propagates untouched
	expect(error).not.toBeInstanceOf(RunLockError);

	expect(exitCodes).toStrictEqual([]);
	expect(errors).toStrictEqual([]);
});
