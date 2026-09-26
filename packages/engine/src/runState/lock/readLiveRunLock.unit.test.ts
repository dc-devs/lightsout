import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readLiveRunLock } from '#src/runState/lock/readLiveRunLock.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** Beyond any OS pid range, as `isRunLive`'s own tests spell a dead holder — process.kill(pid, 0) reports ESRCH. */
const deadPid = 2 ** 30;

interface SetupParams {
	/** The holder written to .lightsout/lock.json; omitted means the checkout holds no lock. */
	heldBy?: { pid: number; runId: string };
}

/** A checkout that either holds a run lock or has never taken one. */
const setupCheckoutLock = ({ heldBy }: SetupParams = {}) => {
	const cwd = setupConsumerRepo({ git: false });

	if (heldBy) {
		const lockPath = join(cwd, '.lightsout', 'lock.json');

		mkdirSync(dirname(lockPath), { recursive: true });
		writeFileSync(lockPath, JSON.stringify({ ...heldBy, startedAt: '2026-07-03T00:00:00.000Z' }), 'utf8');
	}

	return { cwd };
};

/** The two checkouts nothing is running in: one crashed run's leftover, one that never locked. */
const setupNoHolderCheckouts = () => {
	const { cwd: staleCwd } = setupCheckoutLock({ heldBy: { pid: deadPid, runId: 'crashed-run' } });
	const { cwd: freeCwd } = setupCheckoutLock();

	return { staleCwd, freeCwd };
};

describe('readLiveRunLock', () => {
	test("answers the holder while the lock's process is alive", async () => {
		const { cwd } = setupCheckoutLock({ heldBy: { pid: process.pid, runId: 'run-in-flight' } });

		const holder = await readLiveRunLock({ cwd });

		expect(holder).toStrictEqual({ pid: process.pid, runId: 'run-in-flight', startedAt: '2026-07-03T00:00:00.000Z' });
	});

	test("answers no holder for a dead process's lock or a checkout with no lock", async () => {
		const { staleCwd, freeCwd } = setupNoHolderCheckouts();

		const stale = await readLiveRunLock({ cwd: staleCwd });
		const free = await readLiveRunLock({ cwd: freeCwd });

		// a lock whose process is gone is a crash leftover, not a run holding the tree
		expect({ stale, free }).toStrictEqual({ stale: undefined, free: undefined });
	});
});
