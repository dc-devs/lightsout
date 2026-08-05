import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { Driver } from '@/drivers';
import { RunLockError } from '@/runState';
import { loadConfig } from '@/common/utils/loadConfig';
import { runPipelineOrFailFast } from '@/cli/common/utils/runPipelineOrFailFast';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

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
const captureFailFast = ({ t }: { t: TestContext }) => {
	const errors: string[] = [];
	const exitCodes: (number | string | null | undefined)[] = [];

	t.mock.method(console, 'error', (...args: unknown[]) => {
		errors.push(String(args[0]));
	});

	t.mock.method(process, 'exit', (code?: number | string | null): never => {
		exitCodes.push(code);

		throw new Error('process.exit');
	});

	return { errors, exitCodes };
};

/**
 * A real consumer repo the pipeline can run in. `lockedByPid` plants a lock the
 * pipeline will collide with on the way in.
 */
const setupPipelineCall = async ({ t, lockedByPid }: { t: TestContext; lockedByPid?: number }) => {
	const { errors, exitCodes } = captureFailFast({ t });
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
const setupUnusableCwd = async ({ t }: { t: TestContext }) => {
	const { errors, exitCodes } = captureFailFast({ t });
	const repo = setupConsumerRepo({ git: false });

	return { cwd: join(repo, 'plan.md'), config: await loadConfig({ cwd: repo }), errors, exitCodes };
};

test('runPipelineOrFailFast: a live run lock is a clean fail-fast — the message on stderr, exit 1, no stack', async (t) => {
	const { cwd, config, errors, exitCodes } = await setupPipelineCall({ t, lockedByPid: process.pid });

	await assert.rejects(runPipelineOrFailFast({ cwd, planPath: 'plan.md', driver: garbageDriver, config }), /process\.exit/);

	assert.deepEqual(exitCodes, [1]);
	assert.equal(errors.length, 1);
	assert.match(errors[0] ?? '', /^\n/, 'the message is preceded by a blank line so it stands clear of the run output');
	assert.match(errors[0] ?? '', /another lightsout run is active in this repo: run already-running/);
});

test('runPipelineOrFailFast: the pipeline result is handed back untouched when the run completes', async (t) => {
	const { cwd, config, errors, exitCodes } = await setupPipelineCall({ t });

	const result = await runPipelineOrFailFast({ cwd, planPath: 'plan.md', driver: garbageDriver, config });

	assert.equal(result.ok, false, 'a garbage agent report fails the run — a failed run is a returned result, not a fail-fast');
	assert.equal(typeof result.manifest.runId, 'string');
	assert.deepEqual(exitCodes, []);
	assert.deepEqual(errors, []);
});

test('runPipelineOrFailFast: any other error propagates untouched — no message, no exit', async (t) => {
	const { cwd, config, errors, exitCodes } = await setupUnusableCwd({ t });

	await assert.rejects(
		runPipelineOrFailFast({ cwd, planPath: 'plan.md', driver: garbageDriver, config }),
		(error: unknown) => error instanceof Error && !(error instanceof RunLockError),
	);

	assert.deepEqual(exitCodes, []);
	assert.deepEqual(errors, []);
});
