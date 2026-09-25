/**
 * How long ship waits on the forge, and how often it asks while it waits.
 *
 * One statement for both remote waits. The check wait and the merge read-back
 * are the same policy — `confirmMerge` says in its own words that it polls
 * "under the same ceiling the check wait uses" — so a repository whose CI needs
 * a longer ceiling must move both, and two copies of the numbers is how one
 * gets left behind.
 */
export const remoteWaitTimings = { pollIntervalMs: 30_000, ceilingMs: 30 * 60_000 } as const;
