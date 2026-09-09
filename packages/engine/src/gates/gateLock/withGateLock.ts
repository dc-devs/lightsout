import { randomUUID } from 'node:crypto';
import { describeGateCoordinationTimeout } from '#src/gates/common/utils/describeGateCoordinationTimeout.ts';
import { describeGateLockFailure } from '#src/gates/common/utils/describeGateLockFailure.ts';
import { acquireGateLock } from '#src/gates/gateLock/acquireGateLock.ts';
import { gateLockTimings } from '#src/gates/gateLock/common/constants/gateLockTimings.ts';
import type { GateLockOutcome } from '#src/gates/gateLock/common/types/GateLockOutcome.ts';
import { describeGateLockHolder } from '#src/gates/gateLock/common/utils/describeGateLockHolder.ts';
import { getGateLockPath } from '#src/gates/gateLock/common/utils/getGateLockPath.ts';
import { writeGateLockGroups } from '#src/gates/gateLock/common/utils/writeGateLockGroups.ts';
import { releaseGateLock } from '#src/gates/gateLock/releaseGateLock.ts';

interface Params<Result> {
	/** The checkout this run's gates execute in — both the shared-state key and the worktree a waiter names. */
	cwd: string;
	/** Reuse the caller's run id when it has one; a caller without one gets a minted id, as `withRunLock` does. */
	runId?: string;
	/** How long to wait for the machine. `gateLockTimings.waitCeilingMs` when absent; zero means one attempt and no wait. */
	waitCeilingMs?: number;
	onProgress?: (message: string) => void;
	run: (handle: { onGateSpawn: ({ pid }: { pid: number }) => void; onGateExit: ({ pid }: { pid: number }) => void }) => Promise<Result>;
}

/**
 * Hold the shared gate reservation for one whole scheduled gate run, or answer
 * why the machine was never taken.
 *
 * Mirrors `withRunLock` and extends its shape with the wait, because that lock
 * fails fast on a live holder and this one must not: a contending gate run
 * polls under a fixed ceiling and only then gives up. The refusal sentence is
 * picked off the acquisition's `failure` member — set means the reservation
 * could not be written at all, absent means the wait expired against a live
 * holder — because reusing the wait sentence for a read-only disk would tell an
 * operator to wait for a run that does not exist.
 *
 * The reservation's path is resolved ONCE and threaded to every step below.
 * That is load-bearing rather than tidiness: resolving it asks git, and a
 * two-second poll under a thirty-minute ceiling would otherwise spawn about
 * nine hundred `git rev-parse` processes on the machine this whole feature
 * exists to unload.
 *
 * `run` is handed the two callbacks that record and forget a gate's process
 * group. They are synchronous and the persist is not, so every persist is
 * appended to one promise chain and each write carries the whole current set:
 * package groups spawn and exit in the same tick, and an unordered write that
 * dropped a live group is exactly what the reclaim rule would then read.
 *
 * The reservation is released in a `finally` on every exit path, a returned
 * result and a thrown error alike. That is this module's half of the
 * lock-ordering invariant: it is never held past the body it wraps, and nothing
 * inside the body acquires another lock.
 */
export const withGateLock = async <Result>({ cwd, runId, waitCeilingMs, onProgress, run }: Params<Result>): Promise<GateLockOutcome<Result>> => {
	const lockPath = await getGateLockPath({ cwd });
	const heldRunId = runId ?? randomUUID();
	const acquisition = await acquireGateLock({
		lockPath,
		cwd,
		runId: heldRunId,
		waitCeilingMs: waitCeilingMs ?? gateLockTimings.waitCeilingMs,
		onProgress,
	});

	if (!acquisition.acquired) {
		return {
			coordination:
				acquisition.failure === undefined
					? describeGateCoordinationTimeout({ holder: describeGateLockHolder({ lock: acquisition.holder }), waitedMs: acquisition.waitedMs })
					: describeGateLockFailure({ failure: acquisition.failure }),
		};
	}

	const gateGroups = new Set<number>();
	// Serialised, and reading the live set at write time rather than a captured
	// snapshot, so the last write to land is also the one carrying the truth.
	let persisted = Promise.resolve();
	const persist = () => {
		persisted = persisted.then(() => writeGateLockGroups({ lockPath, runId: heldRunId, gateGroups: [...gateGroups] }));
	};

	try {
		const held = await run({
			onGateSpawn: ({ pid }) => {
				gateGroups.add(pid);
				persist();
			},
			onGateExit: ({ pid }) => {
				gateGroups.delete(pid);
				persist();
			},
		});

		return { held };
	} finally {
		await persisted;
		await releaseGateLock({ lockPath, runId: heldRunId });
	}
};
