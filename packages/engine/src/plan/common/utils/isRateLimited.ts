import type { AgentOutcome } from '#src/invoke/index.ts';

interface Params<Report> {
	/** One settled fan-out result, or `undefined` for a task `drainTasks` never started. */
	result: { outcome: AgentOutcome<Report> } | undefined;
}

/**
 * Whether a settled spawn hit the harness rate-limit wall — the one outcome that
 * stops the fan-out feeding it.
 *
 * Spelled once because all three plan fan-outs turn on it identically: a wall
 * met by launching another eighteen spawns into it is still a wall, and three
 * copies of the predicate are three chances for one to stop recognising it.
 */
export const isRateLimited = <Report>({ result }: Params<Report>): boolean => result !== undefined && !result.outcome.ok && result.outcome.rateLimited;
