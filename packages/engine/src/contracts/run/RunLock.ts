import { z } from 'zod';

/**
 * The repo-wide run lock (`.lightsout/lock.json`). One live run per consumer
 * repo — two would fight over the same worktree. The pid is what makes a
 * crash leftover detectable: a lock whose process is dead is stale, not a
 * conflict.
 */
export const RunLock = z.object({
	pid: z.number().int(),
	runId: z.string(),
	startedAt: z.string(),
});

export type RunLock = z.infer<typeof RunLock>;
