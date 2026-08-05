import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Driver } from '@/drivers';
import { acquireRunLock, readRunLock, releaseRunLock, RunLockError } from '@/runState';
import { loadConfig } from '@/common/utils/loadConfig';
import { runImplementPipeline } from '@/pipeline';
import { report } from '@tests/helpers/report';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/** Beyond any OS pid range — process.kill(pid, 0) reports ESRCH, i.e. dead. */
const deadPid = 999_999_999;

const lockPath = (dir: string) => join(dir, '.lightsout', 'lock.json');

/** Permission bits do not apply to root, so the rethrow they provoke is unreachable there. */
const skipAsRoot = process.getuid?.() === 0 ? 'file permissions do not apply to root' : false;

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

test('a lock that exists but cannot be cleared gives up as unacquirable, not as a conflict', async () => {
	const dir = setupConsumerRepo({ git: false });

	// A directory at the lock path always exists (EEXIST) and never unlinks — the
	// steal-and-retry runs out of attempts instead of looping forever.
	mkdirSync(lockPath(dir), { recursive: true });

	await assert.rejects(acquireRunLock({ cwd: dir, runId: 'run-b' }), (thrown: unknown) => {
		assert.ok(thrown instanceof RunLockError);
		assert.match(thrown.message, /could not acquire/);
		assert.doesNotMatch(thrown.message, /another lightsout run is active/, 'nothing live was found — this is not a conflict');

		return true;
	});

	assert.ok(existsSync(lockPath(dir)), 'what it could not clear, it left alone');
});

test('an fs failure that is not a lock conflict is rethrown as itself', { skip: skipAsRoot }, async (t) => {
	const dir = setupConsumerRepo({ git: false });
	const stateDir = join(dir, '.lightsout');

	mkdirSync(stateDir, { recursive: true });
	chmodSync(stateDir, 0o555);
	t.after(() => chmodSync(stateDir, 0o755));

	await assert.rejects(acquireRunLock({ cwd: dir, runId: 'run-a' }), (thrown: unknown) => {
		assert.equal((thrown as NodeJS.ErrnoException).code, 'EACCES');
		assert.ok(!(thrown instanceof RunLockError), 'an unwritable repo is not another run holding the lock');

		return true;
	});
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

test('release with nothing on disk is a no-op, so a failed start can still unwind', async () => {
	const dir = setupConsumerRepo({ git: false });

	await releaseRunLock({ cwd: dir, runId: 'run-a' });

	assert.ok(!existsSync(lockPath(dir)), 'releasing a lock that was never taken creates nothing');
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
