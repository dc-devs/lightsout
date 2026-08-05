import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { readRunLock, RunLockError, withRunLock } from '@/runState';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/** Beyond any OS pid range — process.kill(pid, 0) reports ESRCH, i.e. dead. */
const deadPid = 999_999_999;

interface SetupParams {
	/** A lock already on disk when the run starts: our own pid is a live conflict, a dead one is a crash leftover. */
	heldBy?: { pid: number; runId: string };
}

const setupRunLock = ({ heldBy }: SetupParams = {}) => {
	const cwd = setupConsumerRepo({ git: false });
	const lockPath = join(cwd, '.lightsout', 'lock.json');
	const progress: string[] = [];
	const entered: string[] = [];

	if (heldBy) {
		mkdirSync(join(cwd, '.lightsout'), { recursive: true });
		writeFileSync(lockPath, JSON.stringify({ ...heldBy, startedAt: '2026-07-03T00:00:00.000Z' }), 'utf8');
	}

	const onProgress = (message: string) => {
		progress.push(message);
	};

	return { cwd, lockPath, progress, entered, onProgress };
};

describe('withRunLock', () => {
	test('holds the repo lock under the run id it threads into the body', async () => {
		const { cwd } = setupRunLock();

		const held = await withRunLock({
			params: { cwd },
			run: async ({ runId }) => ({ runId, holder: await readRunLock({ cwd }) }),
		});

		assert.deepEqual(
			{ lockedRunId: held.holder?.runId, lockedPid: held.holder?.pid },
			{ lockedRunId: held.runId, lockedPid: process.pid },
		);
	});

	test('mints a fresh run id for every start', async () => {
		const { cwd } = setupRunLock();

		const first = await withRunLock({ params: { cwd }, run: async ({ runId }) => runId });
		const second = await withRunLock({ params: { cwd }, run: async ({ runId }) => runId });

		assert.notEqual(first, second, 'two starts are two runs — reusing an id would overwrite the earlier run state');
	});

	test('reuses the run id of the run being resumed instead of minting one', async () => {
		const { cwd } = setupRunLock();

		const runId = await withRunLock({
			params: { cwd, existing: { runId: 'run-resumed' } },
			run: async (params) => params.runId,
		});

		assert.equal(runId, 'run-resumed');
	});

	test('returns the body result and releases the lock once the body is done', async () => {
		const { cwd } = setupRunLock();

		const result = await withRunLock({ params: { cwd }, run: async () => 'pipeline result' });

		assert.deepEqual({ result, holder: await readRunLock({ cwd }) }, { result: 'pipeline result', holder: undefined });
	});

	test('releases the lock when the body throws, and lets the failure through untouched', async () => {
		const { cwd } = setupRunLock();
		const failure = new Error('the pipeline escalated');

		await assert.rejects(
			withRunLock({
				params: { cwd },
				run: async () => {
					throw failure;
				},
			}),
			(thrown: unknown) => thrown === failure,
		);

		assert.equal(await readRunLock({ cwd }), undefined, 'a park or escalation still hands the repo back');
	});

	test('hands the body the whole param set it was given, not just the lock slice', async () => {
		const { cwd, onProgress } = setupRunLock();

		const seen = await withRunLock({
			params: { cwd, onProgress, planPath: 'plan.md' },
			run: async (params) => ({ cwd: params.cwd, planPath: params.planPath }),
		});

		assert.deepEqual(seen, { cwd, planPath: 'plan.md' });
	});

	test('takes over a lock left behind by a dead pid and narrates the takeover', async () => {
		const { cwd, progress, onProgress } = setupRunLock({ heldBy: { pid: deadPid, runId: 'crashed-run' } });

		const runId = await withRunLock({ params: { cwd, onProgress }, run: async (params) => params.runId });

		assert.deepEqual(
			{ narrated: progress.filter((line) => line.includes(String(deadPid))).length, tookOver: runId !== 'crashed-run' },
			{ narrated: 1, tookOver: true },
		);
	});

	test('starts on a free lock without narrating a takeover that never happened', async () => {
		const { cwd, progress, onProgress } = setupRunLock();

		await withRunLock({ params: { cwd, onProgress }, run: async () => 'done' });

		assert.deepEqual(progress, []);
	});

	test('takes over a stale lock even with nobody listening for progress', async () => {
		const { cwd } = setupRunLock({ heldBy: { pid: deadPid, runId: 'crashed-run' } });

		const result = await withRunLock({ params: { cwd }, run: async () => 'done' });

		assert.equal(result, 'done', 'narration is optional; the takeover is not');
	});

	test('refuses to start while a live run holds the lock, leaving the body unrun', async () => {
		const { cwd, entered } = setupRunLock({ heldBy: { pid: process.pid, runId: 'already-running' } });

		await assert.rejects(
			withRunLock({
				params: { cwd },
				run: async (params) => {
					entered.push(params.runId);

					return 'done';
				},
			}),
			RunLockError,
		);

		assert.deepEqual(entered, [], 'the conflict is detected before any disk write, so nothing else happened');
	});

	test('leaves the live holder its lock when it refuses to start', async () => {
		const { cwd, lockPath } = setupRunLock({ heldBy: { pid: process.pid, runId: 'already-running' } });

		await assert.rejects(withRunLock({ params: { cwd }, run: async () => 'done' }), RunLockError);

		assert.deepEqual(
			{ present: existsSync(lockPath), holder: (await readRunLock({ cwd }))?.runId },
			{ present: true, holder: 'already-running' },
		);
	});
});
