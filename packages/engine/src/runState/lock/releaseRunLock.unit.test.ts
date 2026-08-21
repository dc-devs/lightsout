import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { releaseRunLock } from '#src/runState/lock/index.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// A directory made read-only mid-test must be writable again or the temp tree
// cannot be removed. Recorded at file scope so a single hook restores it.
let lockedStateDir: string | undefined;

afterEach(() => {
	if (lockedStateDir) {
		chmodSync(lockedStateDir, 0o755);
		lockedStateDir = undefined;
	}
});

interface SetupParams {
	/** A lock already on disk when the release runs — absent means nothing was ever taken. */
	heldBy?: { pid: number; runId: string };
	/** Strip write permission from `.lightsout/`, so the lock file is readable but cannot be unlinked. */
	undeletable?: boolean;
}

const setupRunLock = ({ heldBy, undeletable = false }: SetupParams = {}) => {
	const cwd = setupConsumerRepo({ git: false });
	const stateDir = join(cwd, '.lightsout');
	const lockPath = join(stateDir, 'lock.json');

	mkdirSync(stateDir, { recursive: true });

	if (heldBy) {
		writeFileSync(lockPath, JSON.stringify({ ...heldBy, startedAt: '2026-07-03T00:00:00.000Z' }), 'utf8');
	}

	if (undeletable) {
		chmodSync(stateDir, 0o555);
		lockedStateDir = stateDir;
	}

	return { cwd, lockPath };
};

/** Permission bits do not apply to root, so an undeletable lock cannot be staged there. */
// Jest has no per-call `{ skip }` option, so the choice is made at the call site.
const testUnlessRoot = process.getuid?.() === 0 ? test.skip : test;

describe('releaseRunLock', () => {
	testUnlessRoot('leaves a lock it owns but cannot delete on disk, without turning the run exit into a failure', async () => {
		const { cwd, lockPath } = setupRunLock({ heldBy: { pid: process.pid, runId: 'run-a' }, undeletable: true });

		await releaseRunLock({ cwd, runId: 'run-a' });

		expect(existsSync(lockPath)).toBe(true);
	});

	test('never deletes a lock owned by another pid', async () => {
		// beyond any OS pid range — process.kill(pid, 0) reports ESRCH, i.e. dead
		const deadPid = 999_999_999;
		const { cwd, lockPath } = setupRunLock({ heldBy: { pid: deadPid, runId: 'other-run' } });

		await releaseRunLock({ cwd, runId: 'other-run' });

		// foreign pid survives
		expect(existsSync(lockPath)).toBeTruthy();
	});

	test('never deletes a lock owned by another run', async () => {
		const { cwd, lockPath } = setupRunLock({ heldBy: { pid: process.pid, runId: 'other-run' } });

		await releaseRunLock({ cwd, runId: 'not-that-run' });

		// foreign runId survives
		expect(existsSync(lockPath)).toBeTruthy();
	});

	test('release with nothing on disk is a no-op, so a failed start can still unwind', async () => {
		const { cwd, lockPath } = setupRunLock();

		await releaseRunLock({ cwd, runId: 'run-a' });

		// releasing a lock that was never taken creates nothing
		expect(existsSync(lockPath)).toBeFalsy();
	});
});
