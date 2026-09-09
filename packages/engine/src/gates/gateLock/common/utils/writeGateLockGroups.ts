import { writeFile } from 'node:fs/promises';
import { readGateLock } from '#src/gates/gateLock/readGateLock.ts';

interface Params {
	lockPath: string;
	runId: string;
	/** The whole current set of live gate process groups, never a delta — so the last write to land is also the correct one. */
	gateGroups: number[];
}

/**
 * Persist the gate process groups executing right now into the reservation.
 *
 * The group list is the one part of the document that moves while the machine
 * is held — there is no heartbeat and no timer — so this runs only when the set
 * changes. `startedAt` is never rewritten: it is what lets a waiter report the
 * reservation's age.
 *
 * Only our own document is rewritten, following the same rule as
 * `releaseGateLock`. A write that fails is swallowed rather than raised: a
 * reservation that is held must not be dropped over a transient write.
 *
 * The read-then-write is not atomic and does not need to be. Reclaiming
 * requires the holder's pid to be dead, and a process whose pid is dead is
 * running no group write, so the window in which a reclaimer could unlink
 * between our read and our write cannot open. Written down so nobody reaches
 * for file locking to close a gap that is not there.
 */
export const writeGateLockGroups = async ({ lockPath, runId, gateGroups }: Params): Promise<void> => {
	const holder = readGateLock({ lockPath });

	if (!holder || holder.pid !== process.pid || holder.runId !== runId) {
		return;
	}

	await writeFile(lockPath, `${JSON.stringify({ ...holder, gateGroups }, null, '\t')}\n`, 'utf8').catch(() => undefined);
};
