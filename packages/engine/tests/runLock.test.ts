import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Driver } from '@lightsout/drivers';
import { acquireRunLock } from '../src/runState/acquireRunLock';
import { loadConfig, runImplementPipeline } from '../src/index';
import { readRunLock } from '../src/runState/readRunLock';
import { releaseRunLock } from '../src/runState/releaseRunLock';
import { RunLockError } from '../src/runState/RunLockError';
import { report } from './helpers/report';
import { roleOf } from './helpers/roleOf';
import { setupConsumerRepo } from './helpers/setupConsumerRepo';

/** Beyond any OS pid range — process.kill(pid, 0) reports ESRCH, i.e. dead. */
const deadPid = 999_999_999;

const lockPath = (dir: string) => join(dir, '.lightsout', 'lock.json');

const plantLock = ({ dir, pid, runId }: { dir: string; pid: number; runId: string }) => {
	mkdirSync(join(dir, '.lightsout'), { recursive: true });
	writeFileSync(lockPath(dir), JSON.stringify({ pid, runId, startedAt: new Date().toISOString() }));
};

/** A stub driver that walks the happy path: implement → tests → refactor-complete. */
const happyDriver = (dir: string): Driver => ({
	name: 'stub',
	invoke: async ({ prompt }) => {
		const role = roleOf(prompt);

		if (role === 'write-tests') {
			mkdirSync(join(dir, 'test'), { recursive: true });
			writeFileSync(join(dir, 'test/feature.test.js'), '// stub test\n');

			return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
		}

		if (role === 'refactor') {
			return { text: report(), exitCode: 0 };
		}

		writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');

		return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
	},
});

test('acquire → lock on disk with our pid; release → gone', async () => {
	const dir = setupConsumerRepo({ git: false });
	const acquired = await acquireRunLock({ cwd: dir, runId: 'run-a' });

	assert.equal(acquired.stalePid, undefined);

	const lock = await readRunLock({ cwd: dir });

	assert.equal(lock?.pid, process.pid);
	assert.equal(lock?.runId, 'run-a');

	await releaseRunLock({ cwd: dir, runId: 'run-a' });
	assert.ok(!existsSync(lockPath(dir)));
});

test('a second acquire against a live holder fails fast with RunLockError', async () => {
	const dir = setupConsumerRepo({ git: false });

	await acquireRunLock({ cwd: dir, runId: 'run-a' });
	await assert.rejects(acquireRunLock({ cwd: dir, runId: 'run-b' }), RunLockError);
	await assert.rejects(acquireRunLock({ cwd: dir, runId: 'run-b' }), /run run-a \(pid \d+/);
});

test('a lock from a dead pid is stale — stolen and reported', async () => {
	const dir = setupConsumerRepo({ git: false });

	plantLock({ dir, pid: deadPid, runId: 'crashed-run' });

	const acquired = await acquireRunLock({ cwd: dir, runId: 'run-b' });

	assert.equal(acquired.stalePid, deadPid);
	assert.equal((await readRunLock({ cwd: dir }))?.runId, 'run-b');
});

test('a corrupt lock is stale, not fatal', async () => {
	const dir = setupConsumerRepo({ git: false });

	mkdirSync(join(dir, '.lightsout'), { recursive: true });
	writeFileSync(lockPath(dir), 'not json at all');

	const acquired = await acquireRunLock({ cwd: dir, runId: 'run-b' });

	assert.equal(acquired.stalePid, undefined);
	assert.equal((await readRunLock({ cwd: dir }))?.runId, 'run-b');
});

test('release never deletes a lock owned by another pid or run', async () => {
	const dir = setupConsumerRepo({ git: false });

	plantLock({ dir, pid: deadPid, runId: 'other-run' });
	await releaseRunLock({ cwd: dir, runId: 'other-run' });
	assert.ok(existsSync(lockPath(dir)), 'foreign pid survives');

	plantLock({ dir, pid: process.pid, runId: 'other-run' });
	await releaseRunLock({ cwd: dir, runId: 'not-that-run' });
	assert.ok(existsSync(lockPath(dir)), 'foreign runId survives');
});

test('pipeline start against a live lock fails fast — no orphan run directory', async () => {
	const dir = setupConsumerRepo();

	plantLock({ dir, pid: process.pid, runId: 'already-running' });

	const config = await loadConfig({ cwd: dir });

	await assert.rejects(
		runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver: happyDriver(dir), config }),
		RunLockError,
	);

	assert.ok(!existsSync(join(dir, '.lightsout', 'runs')), 'nothing was written');
});

test('pipeline holds the lock while running, steals a stale one, releases on pass', async () => {
	const dir = setupConsumerRepo();

	plantLock({ dir, pid: deadPid, runId: 'crashed-run' });

	const config = await loadConfig({ cwd: dir });
	const progressLines: string[] = [];
	let heldDuringRun = false;

	const result = await runImplementPipeline({
		cwd: dir,
		planPath: 'plan.md',
		driver: happyDriver(dir),
		config,
		onProgress: (message) => {
			progressLines.push(message);
			heldDuringRun = heldDuringRun || existsSync(lockPath(dir));
		},
	});

	assert.equal(result.ok, true);
	assert.ok(progressLines.some((line) => line.includes(`stale run lock from dead pid ${deadPid}`)));
	assert.ok(heldDuringRun, 'lock existed mid-run');
	assert.ok(!existsSync(lockPath(dir)), 'lock released after pass');

	const lock = await readRunLock({ cwd: dir });

	assert.equal(lock, undefined);

	const runIds = readdirSync(join(dir, '.lightsout', 'runs'));

	assert.ok(runIds.includes(result.manifest.runId));
});

test('pipeline releases the lock on a failed run too', async () => {
	const dir = setupConsumerRepo();
	const garbageDriver: Driver = {
		name: 'stub',
		invoke: async () => ({ text: 'not a report', exitCode: 0 }),
	};

	const config = await loadConfig({ cwd: dir });
	const result = await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver: garbageDriver, config });

	assert.equal(result.ok, false);
	assert.ok(!existsSync(lockPath(dir)), 'lock released after failure');
});
