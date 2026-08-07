import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from '@jest/globals';
import type { Driver } from '@/drivers';
import { acquireRunLock, readRunLock, releaseRunLock, RunLockError } from '@/runState';
import { loadConfig } from '@/common/utils/loadConfig';
import { runImplementPipeline } from '@/pipeline';
import { getRejectionError } from '@tests/helpers/getRejectionError';
import { report } from '@tests/helpers/report';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/** Beyond any OS pid range — process.kill(pid, 0) reports ESRCH, i.e. dead. */
const deadPid = 999_999_999;

const lockPath = (dir: string) => join(dir, '.lightsout', 'lock.json');

/** Permission bits do not apply to root, so the rethrow they provoke is unreachable there. */
const skipAsRoot = process.getuid?.() === 0 ? 'file permissions do not apply to root' : false;
// Jest has no per-call `{ skip }` option, so the choice is made at the call site.
const testUnlessRoot = skipAsRoot ? test.skip : test;

// The one cleanup tests/config/setupTestEnvironment.ts cannot cover: a directory
// made read-only mid-test must be writable again or the temp tree cannot be
// removed. Recorded at file scope so a single hook restores it.
let lockedStateDir: string | undefined;

afterEach(() => {
	if (lockedStateDir) {
		chmodSync(lockedStateDir, 0o755);
		lockedStateDir = undefined;
	}
});

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

	expect(acquired.stalePid).toBe(undefined);

	const lock = await readRunLock({ cwd: dir });

	expect(lock?.pid).toBe(process.pid);
	expect(lock?.runId).toBe('run-a');

	await releaseRunLock({ cwd: dir, runId: 'run-a' });
	expect(existsSync(lockPath(dir))).toBeFalsy();
});

test('a second acquire against a live holder fails fast with RunLockError', async () => {
	const dir = setupConsumerRepo({ git: false });

	await acquireRunLock({ cwd: dir, runId: 'run-a' });
	await expect(acquireRunLock({ cwd: dir, runId: 'run-b' })).rejects.toThrow(RunLockError);
	await expect(acquireRunLock({ cwd: dir, runId: 'run-b' })).rejects.toThrow(/run run-a \(pid \d+/);
});

test('a lock from a dead pid is stale — stolen and reported', async () => {
	const dir = setupConsumerRepo({ git: false });

	plantLock({ dir, pid: deadPid, runId: 'crashed-run' });

	const acquired = await acquireRunLock({ cwd: dir, runId: 'run-b' });

	expect(acquired.stalePid).toBe(deadPid);
	expect((await readRunLock({ cwd: dir }))?.runId).toBe('run-b');
});

test('a corrupt lock is stale, not fatal', async () => {
	const dir = setupConsumerRepo({ git: false });

	mkdirSync(join(dir, '.lightsout'), { recursive: true });
	writeFileSync(lockPath(dir), 'not json at all');

	const acquired = await acquireRunLock({ cwd: dir, runId: 'run-b' });

	expect(acquired.stalePid).toBe(undefined);
	expect((await readRunLock({ cwd: dir }))?.runId).toBe('run-b');
});

test('a lock that exists but cannot be cleared gives up as unacquirable, not as a conflict', async () => {
	const dir = setupConsumerRepo({ git: false });

	// A directory at the lock path always exists (EEXIST) and never unlinks — the
	// steal-and-retry runs out of attempts instead of looping forever.
	mkdirSync(lockPath(dir), { recursive: true });

	const thrown = await getRejectionError({ promise: acquireRunLock({ cwd: dir, runId: 'run-b' }) });

	expect(thrown).toBeInstanceOf(RunLockError);
	expect(thrown.message).toMatch(/could not acquire/);
	// nothing live was found — this is not a conflict
	expect(thrown.message).not.toMatch(/another lightsout run is active/);

	// what it could not clear, it left alone
	expect(existsSync(lockPath(dir))).toBeTruthy();
});

testUnlessRoot('an fs failure that is not a lock conflict is rethrown as itself', async () => {
	const dir = setupConsumerRepo({ git: false });
	const stateDir = join(dir, '.lightsout');

	mkdirSync(stateDir, { recursive: true });
	chmodSync(stateDir, 0o555);
	lockedStateDir = stateDir;

	const thrown = await getRejectionError({ promise: acquireRunLock({ cwd: dir, runId: 'run-a' }) });

	expect((thrown as NodeJS.ErrnoException).code).toBe('EACCES');
	// an unwritable repo is not another run holding the lock
	expect(thrown).not.toBeInstanceOf(RunLockError);
});

test('release never deletes a lock owned by another pid or run', async () => {
	const dir = setupConsumerRepo({ git: false });

	plantLock({ dir, pid: deadPid, runId: 'other-run' });
	await releaseRunLock({ cwd: dir, runId: 'other-run' });
	// foreign pid survives
	expect(existsSync(lockPath(dir))).toBeTruthy();

	plantLock({ dir, pid: process.pid, runId: 'other-run' });
	await releaseRunLock({ cwd: dir, runId: 'not-that-run' });
	// foreign runId survives
	expect(existsSync(lockPath(dir))).toBeTruthy();
});

test('release with nothing on disk is a no-op, so a failed start can still unwind', async () => {
	const dir = setupConsumerRepo({ git: false });

	await releaseRunLock({ cwd: dir, runId: 'run-a' });

	// releasing a lock that was never taken creates nothing
	expect(existsSync(lockPath(dir))).toBeFalsy();
});

test('pipeline start against a live lock fails fast — no orphan run directory', async () => {
	const dir = setupConsumerRepo();

	plantLock({ dir, pid: process.pid, runId: 'already-running' });

	const config = await loadConfig({ cwd: dir });

	await expect(runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver: happyDriver(dir), config })).rejects.toThrow(RunLockError);

	// nothing was written
	expect(existsSync(join(dir, '.lightsout', 'runs'))).toBeFalsy();
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

	expect(result.ok).toBe(true);
	expect(progressLines.some((line) => line.includes(`stale run lock from dead pid ${deadPid}`))).toBeTruthy();
	// lock existed mid-run
	expect(heldDuringRun).toBeTruthy();
	// lock released after pass
	expect(existsSync(lockPath(dir))).toBeFalsy();

	const lock = await readRunLock({ cwd: dir });

	expect(lock).toBe(undefined);

	const runIds = readdirSync(join(dir, '.lightsout', 'runs'));

	expect(runIds.includes(result.manifest.runId)).toBeTruthy();
});

test('pipeline releases the lock on a failed run too', async () => {
	const dir = setupConsumerRepo();
	const garbageDriver: Driver = {
		name: 'stub',
		invoke: async () => ({ text: 'not a report', exitCode: 0 }),
	};

	const config = await loadConfig({ cwd: dir });
	const result = await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver: garbageDriver, config });

	expect(result.ok).toBe(false);
	// lock released after failure
	expect(existsSync(lockPath(dir))).toBeFalsy();
});
