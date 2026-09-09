import { z } from 'zod';

/**
 * The shared gate reservation (`<primary checkout>/.lightsout/gate-lock.json`).
 * One whole scheduled gate run at a time across every worktree of one
 * repository on one machine — four worktrees starting `pnpm test` in the same
 * second is what makes a suite that passes alone die under load.
 *
 * There is deliberately no heartbeat field: the reclaim rule is the holder pid
 * plus the live gate groups, and the reservation's age comes from `startedAt`,
 * so a field written on a timer would be read by nobody.
 */
export const GateLock = z.object({
	/** The holder's process. Dead means the engine is gone — half of what makes a leftover reclaimable. */
	pid: z.number().int(),
	runId: z.string(),
	/** The checkout the holder runs its gates in, which is what a waiting run names. */
	worktree: z.string(),
	/** When the machine was taken, and so the only place a waiter can read the reservation's age from. */
	startedAt: z.string(),
	/**
	 * The process groups of the gate commands executing right now. Gates are
	 * spawned detached, so a killed engine leaves these running: reclaiming on
	 * the dead pid alone would stack a second run's suites on top of them.
	 */
	gateGroups: z.array(z.number().int()),
});

export type GateLock = z.infer<typeof GateLock>;
