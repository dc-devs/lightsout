import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { releaseRunLock } from '#src/runState/index.ts';
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
	/** Strip write permission from `.lightsout/`, so the lock file is readable but cannot be unlinked. */
	undeletable?: boolean;
}

const setupHeldLock = ({ undeletable = false }: SetupParams = {}) => {
	const cwd = setupConsumerRepo({ git: false });
	const stateDir = join(cwd, '.lightsout');
	const lockPath = join(stateDir, 'lock.json');

	mkdirSync(stateDir, { recursive: true });
	writeFileSync(lockPath, JSON.stringify({ pid: process.pid, runId: 'run-a', startedAt: '2026-07-03T00:00:00.000Z' }), 'utf8');

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
		const { cwd, lockPath } = setupHeldLock({ undeletable: true });

		await releaseRunLock({ cwd, runId: 'run-a' });

		expect(existsSync(lockPath)).toBe(true);
	});
});
