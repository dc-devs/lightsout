import { isProcessGroupAlive } from '#src/common/processes/isProcessGroupAlive.ts';
import type { GateLock } from '#src/contracts/index.ts';
import { isPidAlive } from '#src/runState/index.ts';

interface Params {
	lock: GateLock;
}

/**
 * Whether a reservation is a leftover the next run may claim: the holder's pid
 * is dead AND no gate process group it recorded is still alive.
 *
 * Both conditions are required. `runCommand` spawns every gate detached, so a
 * killed engine leaves live gate groups with nothing to reap them — reclaiming
 * on the dead pid alone would put a second run's suites on top of the first
 * one's, which is the exact failure the reservation exists to prevent.
 *
 * There is deliberately no age-based expiry: a long gate run is not a stale one,
 * and these two conditions are the whole test.
 */
export const isGateLockReclaimable = ({ lock }: Params): boolean => {
	return !isPidAlive({ pid: lock.pid }) && !lock.gateGroups.some((pgid) => isProcessGroupAlive({ pgid }));
};
