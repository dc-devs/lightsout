import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { AgentOutcome } from '#src/invoke/common/types/AgentOutcome.ts';

interface Params {
	outcome: AgentOutcome<unknown>;
}

/**
 * How one agent call settled, as the status an activity level closes with.
 *
 * Written once because every plan level whose whole content is a single agent
 * call — a step, and each repair or reshape round — closes on exactly this
 * reading, and three copies of it are three chances for one to record a
 * rate-limited spawn as an ordinary failure. A parked call is deliberately not
 * a failure: the wall is a resumable state the engine already spells that way.
 */
export const getAgentOutcomeStatus = ({ outcome }: Params): RunStatus =>
	outcome.ok ? RunStatus.Passed : outcome.rateLimited ? RunStatus.PausedRateLimit : RunStatus.Failed;
