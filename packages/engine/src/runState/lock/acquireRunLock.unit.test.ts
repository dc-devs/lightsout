import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { acquireRunLock, RunLockError, readRunLock, releaseRunLock } from '#src/runState/lock/index.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** Beyond any OS pid range — process.kill(pid, 0) reports ESRCH, i.e. dead. */
const deadPid = 999_999_999;

/** Permission bits do not apply to root, so the rethrow they provoke is unreachable there. */
// Jest has no per-call `{ skip }` option, so the choice is made at the call site.
const testUnlessRoot = process.getuid?.() === 0 ? test.skip : test;

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

interface SetupParams {
	/** A lock already on disk when the acquire runs: a live pid is a conflict, a dead one a crash leftover. */
	heldBy?: { pid: number; runId: string };
	/** Plant unparseable bytes at the lock path instead of a lock record. */
	corrupt?: boolean;
	/** Plant a directory at the lock path — it always exists and never unlinks. */
	unclearable?: boolean;
	/** Strip write permission from `.lightsout/`, so nothing can be written there at all. */
	unwritable?: boolean;
}

const setupRunLock = ({ heldBy, corrupt = false, unclearable = false, unwritable = false }: SetupParams = {}) => {
	const cwd = setupConsumerRepo({ git: false });
	const stateDir = join(cwd, '.lightsout');
	const lockPath = join(stateDir, 'lock.json');

	mkdirSync(stateDir, { recursive: true });

	if (heldBy) {
		writeFileSync(lockPath, JSON.stringify({ ...heldBy, startedAt: new Date().toISOString() }), 'utf8');
	}

	if (corrupt) {
		writeFileSync(lockPath, 'not json at all');
	}

	if (unclearable) {
		mkdirSync(lockPath, { recursive: true });
	}

	if (unwritable) {
		chmodSync(stateDir, 0o555);
		lockedStateDir = stateDir;
	}

	return { cwd, lockPath };
};

describe('acquireRunLock', () => {
	test('acquire → lock on disk with our pid; release → gone', async () => {
		const { cwd, lockPath } = setupRunLock();

		const acquired = await acquireRunLock({ cwd, runId: 'run-a' });

		expect(acquired.stalePid).toBe(undefined);

		const lock = await readRunLock({ cwd });

		expect(lock?.pid).toBe(process.pid);
		expect(lock?.runId).toBe('run-a');

		await releaseRunLock({ cwd, runId: 'run-a' });
		expect(existsSync(lockPath)).toBeFalsy();
	});

	test('a second acquire against a live holder fails fast with RunLockError', async () => {
		const { cwd } = setupRunLock();

		await acquireRunLock({ cwd, runId: 'run-a' });
		await expect(acquireRunLock({ cwd, runId: 'run-b' })).rejects.toThrow(RunLockError);
		await expect(acquireRunLock({ cwd, runId: 'run-b' })).rejects.toThrow(/run run-a \(pid \d+/);
	});

	test('a lock from a dead pid is stale — stolen and reported', async () => {
		const { cwd } = setupRunLock({ heldBy: { pid: deadPid, runId: 'crashed-run' } });

		const acquired = await acquireRunLock({ cwd, runId: 'run-b' });

		expect(acquired.stalePid).toBe(deadPid);
		expect((await readRunLock({ cwd }))?.runId).toBe('run-b');
	});

	test('a corrupt lock is stale, not fatal', async () => {
		const { cwd } = setupRunLock({ corrupt: true });

		const acquired = await acquireRunLock({ cwd, runId: 'run-b' });

		expect(acquired.stalePid).toBe(undefined);
		expect((await readRunLock({ cwd }))?.runId).toBe('run-b');
	});

	test('a lock that exists but cannot be cleared gives up as unacquirable, not as a conflict', async () => {
		// A directory at the lock path always exists (EEXIST) and never unlinks — the
		// steal-and-retry runs out of attempts instead of looping forever.
		const { cwd, lockPath } = setupRunLock({ unclearable: true });

		const thrown = await getRejectionError({ promise: acquireRunLock({ cwd, runId: 'run-b' }) });

		expect(thrown).toBeInstanceOf(RunLockError);
		expect(thrown.message).toMatch(/could not acquire/);
		// nothing live was found — this is not a conflict
		expect(thrown.message).not.toMatch(/another lightsout run is active/);

		// what it could not clear, it left alone
		expect(existsSync(lockPath)).toBeTruthy();
	});

	testUnlessRoot('an fs failure that is not a lock conflict is rethrown as itself', async () => {
		const { cwd } = setupRunLock({ unwritable: true });

		const thrown = await getRejectionError({ promise: acquireRunLock({ cwd, runId: 'run-a' }) });

		expect((thrown as NodeJS.ErrnoException).code).toBe('EACCES');
		// an unwritable repo is not another run holding the lock
		expect(thrown).not.toBeInstanceOf(RunLockError);
	});
});
